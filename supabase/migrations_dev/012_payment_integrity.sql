-- =====================================================
-- MIGRATION: 012_payment_integrity.sql
-- =====================================================
-- Descripción:
--   1) reserve_coupon: reserva atómica de cupón. Bloquea la fila del cupón
--      (FOR UPDATE) para que dos checkouts simultáneos no superen
--      max_redemptions_total, y aplica max_redemptions_per_customer.
--      Sustituye a check_coupon_availability + create_coupon_reservation.
--   2) apply_mp_payment: procesa una notificación de Mercado Pago en una sola
--      transacción con la orden bloqueada. Es idempotente (notificaciones
--      duplicadas o concurrentes no descuentan stock dos veces), verifica
--      importe y moneda, y no aprueba órdenes canceladas.
--   3) cleanup_expired_reservations: ya no borra reservas de órdenes que
--      siguen pendientes de pago, para que un pago lento (PSE, efectivo)
--      todavía registre el uso del cupón. Las reservas expiradas no cuentan
--      para los límites (las consultas filtran por expires_at).
-- Idempotente: se puede ejecutar varias veces.
-- OJO: 013_stock_reservations.sql reemplaza apply_mp_payment. Si se vuelve a
-- ejecutar esta migración después de la 013, hay que ejecutar la 013 otra vez.
-- =====================================================

begin;

-- =====================================================
-- 1. Reserva atómica de cupón
-- =====================================================
-- Retorna: RESERVED | INVALID | EXHAUSTED | CUSTOMER_LIMIT

create or replace function public.reserve_coupon(
  p_order_id uuid,
  p_discount_id uuid,
  p_email text,
  p_amount_applied_cents int
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  d discount_codes%rowtype;
  v_used int;
begin
  select * into d from discount_codes where id = p_discount_id for update;

  if not found or not d.is_active then
    return 'INVALID';
  end if;

  if d.max_redemptions_total is not null then
    select
      (select count(*) from order_discounts where discount_id = d.id)
      + (select count(*) from coupon_reservations
          where discount_id = d.id and expires_at > now())
    into v_used;

    if v_used >= d.max_redemptions_total then
      return 'EXHAUSTED';
    end if;
  end if;

  if d.max_redemptions_per_customer is not null then
    select
      (select count(*)
         from order_discounts od
         join orders o on o.id = od.order_id
        where od.discount_id = d.id
          and lower(o.email) = lower(p_email))
      + (select count(*)
           from coupon_reservations r
           join orders o on o.id = r.order_id
          where r.discount_id = d.id
            and r.expires_at > now()
            and r.order_id <> p_order_id
            and lower(o.email) = lower(p_email))
    into v_used;

    if v_used >= d.max_redemptions_per_customer then
      return 'CUSTOMER_LIMIT';
    end if;
  end if;

  insert into coupon_reservations (
    order_id, discount_id, code_snapshot, type_snapshot,
    value_percent_snapshot, value_cents_snapshot,
    amount_applied_cents, currency, expires_at
  ) values (
    p_order_id, d.id, d.code, d.type,
    d.value_percent, d.value_cents,
    p_amount_applied_cents, d.currency, now() + interval '30 minutes'
  );

  return 'RESERVED';
end;
$$;

-- =====================================================
-- 2. Aplicar pago de Mercado Pago
-- =====================================================
-- Retorna:
--   PAID             orden marcada como pagada (stock y cupón aplicados)
--   ALREADY_PAID     notificación repetida, nada que hacer
--   UPDATED          estado de pago actualizado (pendiente/rechazado/...)
--   PAYMENT_REVERSED pago reembolsado/contracargado sobre una orden pagada
--   NOT_FOUND        no existe la orden
--   NOT_PAYABLE      pago aprobado sobre una orden no pendiente (p. ej. CANCELLED)
--   AMOUNT_MISMATCH  importe o moneda no coinciden con la orden
--   OUT_OF_STOCK     pago aprobado pero no hay stock suficiente
-- Los tres últimos requieren revisión manual (posible reembolso).

create or replace function public.apply_mp_payment(
  p_order_number text,
  p_payment_id text,
  p_mp_status text,
  p_paid_cents bigint,
  p_currency text,
  p_tolerance_cents bigint,
  p_raw jsonb
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  o orders%rowtype;
  v_status payment_status;
  it record;
begin
  -- Serializa notificaciones concurrentes de la misma orden
  select * into o from orders where order_number = p_order_number for update;
  if not found then
    return 'NOT_FOUND';
  end if;

  v_status := case lower(coalesce(p_mp_status, ''))
    when 'approved' then 'APPROVED'
    when 'rejected' then 'REJECTED'
    when 'cancelled' then 'CANCELLED'
    when 'refunded' then 'REFUNDED'
    when 'charged_back' then 'REFUNDED'
    else 'PENDING' -- pending, in_process, authorized, in_mediation
  end::payment_status;

  if o.status in ('PAID', 'FULFILLED') then
    -- No degradar una orden pagada por notificaciones fuera de orden;
    -- sí registrar reembolsos/contracargos.
    if v_status in ('REFUNDED', 'CANCELLED') then
      update orders
         set payment_status = v_status, payment_raw = p_raw
       where id = o.id;
      return 'PAYMENT_REVERSED';
    end if;
    return 'ALREADY_PAID';
  end if;

  update orders
     set payment_status = v_status,
         payment_id = p_payment_id,
         payment_raw = p_raw
   where id = o.id;

  if v_status <> 'APPROVED' then
    return 'UPDATED';
  end if;

  if o.status <> 'CREATED' then
    return 'NOT_PAYABLE';
  end if;

  if p_currency is distinct from o.currency
     or p_paid_cents < o.total_cents - greatest(p_tolerance_cents, 0) then
    return 'AMOUNT_MISMATCH';
  end if;

  -- Stock: todo o nada (el bloque hace rollback parcial si falta alguno)
  begin
    for it in
      select variant_id, sum(quantity)::int as qty
        from order_items
       where order_id = o.id
       group by variant_id
       order by variant_id -- orden fijo para evitar deadlocks
    loop
      update product_variants
         set in_stock = in_stock - it.qty, updated_at = now()
       where id = it.variant_id
         and in_stock >= it.qty;

      if not found then
        raise exception 'OUT_OF_STOCK %', it.variant_id;
      end if;
    end loop;
  exception
    when raise_exception then
      return 'OUT_OF_STOCK';
  end;

  -- Cupones: confirmar reservas aunque hayan expirado (el pago ya entró)
  insert into order_discounts (
    order_id, discount_id, code_snapshot, type_snapshot,
    value_percent_snapshot, value_cents_snapshot, amount_applied_cents,
    currency, applies_to_all_products_snapshot,
    applicable_product_ids_snapshot, applicable_category_ids_snapshot
  )
  select r.order_id, r.discount_id, r.code_snapshot, r.type_snapshot,
         r.value_percent_snapshot, r.value_cents_snapshot,
         r.amount_applied_cents, r.currency,
         coalesce(d.applies_to_all_products, true),
         d.applicable_product_ids, d.applicable_category_ids
    from coupon_reservations r
    join discount_codes d on d.id = r.discount_id
   where r.order_id = o.id;

  delete from coupon_reservations where order_id = o.id;

  update orders set status = 'PAID' where id = o.id;

  return 'PAID';
end;
$$;

-- =====================================================
-- 3. Limpieza: conservar reservas de órdenes pendientes
-- =====================================================

create or replace function public.cleanup_expired_reservations()
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  delete from coupon_reservations r
   where r.expires_at < now()
     and (
       r.expires_at < now() - interval '7 days'
       or not exists (
         select 1 from orders o
          where o.id = r.order_id and o.status = 'CREATED'
       )
     );
end;
$$;

-- =====================================================
-- 4. Permisos: solo Edge Functions (service_role)
-- =====================================================

revoke execute on function public.reserve_coupon(uuid, uuid, text, int)
  from public, anon, authenticated;
grant execute on function public.reserve_coupon(uuid, uuid, text, int)
  to service_role;

revoke execute on function public.apply_mp_payment(text, text, text, bigint, text, bigint, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_mp_payment(text, text, text, bigint, text, bigint, jsonb)
  to service_role;

revoke execute on function public.cleanup_expired_reservations()
  from public, anon, authenticated;
grant execute on function public.cleanup_expired_reservations()
  to service_role;

commit;
