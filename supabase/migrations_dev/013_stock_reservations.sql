-- =====================================================
-- MIGRATION: 013_stock_reservations.sql
-- =====================================================
-- Descripción: reserva de stock en el checkout para evitar sobreventa.
--
-- Antes el stock solo se descontaba al aprobarse el pago, así que dos
-- compradores podían pagar la última unidad. Ahora:
--   - create-preference descuenta el stock al crear la orden
--     (reserve_order_stock) y marca orders.stock_reserved.
--   - apply_mp_payment consume esa reserva en vez de descontar otra vez.
--   - cancel_order y expire_stale_orders devuelven el stock de órdenes que no
--     se pagan (la preferencia de MP expira a la vez que la reserva).
-- Requiere 012_payment_integrity.sql. Idempotente.
-- =====================================================

begin;

alter table orders
  add column if not exists stock_reserved boolean not null default false,
  add column if not exists reservation_expires_at timestamptz;

create index if not exists idx_orders_reservation_expiry
  on orders (reservation_expires_at)
  where status = 'CREATED' and stock_reserved;

-- =====================================================
-- 1. Reservar stock de una orden (todo o nada)
-- =====================================================
-- Retorna: RESERVED | ALREADY_RESERVED | NOT_PAYABLE | NOT_FOUND | OUT_OF_STOCK

create or replace function public.reserve_order_stock(
  p_order_id uuid,
  p_ttl_minutes int
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  o orders%rowtype;
  it record;
begin
  select * into o from orders where id = p_order_id for update;
  if not found then
    return 'NOT_FOUND';
  end if;
  if o.stock_reserved then
    return 'ALREADY_RESERVED';
  end if;
  if o.status <> 'CREATED' then
    return 'NOT_PAYABLE';
  end if;

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
         and is_active = true
         and deleted_at is null
         and in_stock >= it.qty;

      if not found then
        raise exception 'OUT_OF_STOCK %', it.variant_id;
      end if;
    end loop;
  exception
    when raise_exception then
      return 'OUT_OF_STOCK';
  end;

  update orders
     set stock_reserved = true,
         reservation_expires_at = now() + make_interval(mins => greatest(p_ttl_minutes, 1))
   where id = o.id;

  return 'RESERVED';
end;
$$;

-- =====================================================
-- 2. Devolver stock reservado (uso interno, orden ya bloqueada)
-- =====================================================

create or replace function public.release_order_stock(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  it record;
begin
  -- Solo devuelve si la reserva sigue activa (idempotente)
  update orders
     set stock_reserved = false
   where id = p_order_id
     and stock_reserved;
  if not found then
    return;
  end if;

  for it in
    select variant_id, sum(quantity)::int as qty
      from order_items
     where order_id = p_order_id
     group by variant_id
     order by variant_id
  loop
    update product_variants
       set in_stock = in_stock + it.qty, updated_at = now()
     where id = it.variant_id;
  end loop;
end;
$$;

-- =====================================================
-- 3. Cancelar orden (cliente, admin o fallo en checkout)
-- =====================================================
-- p_only_pending = true: solo cancela órdenes CREATED (uso del cliente).
-- Retorna: CANCELLED | ALREADY_CANCELLED | NOT_CANCELLABLE | NOT_FOUND

create or replace function public.cancel_order(
  p_order_id uuid,
  p_only_pending boolean default true
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  o orders%rowtype;
begin
  select * into o from orders where id = p_order_id for update;
  if not found then
    return 'NOT_FOUND';
  end if;
  if o.status = 'CANCELLED' then
    return 'ALREADY_CANCELLED';
  end if;
  if p_only_pending and o.status <> 'CREATED' then
    return 'NOT_CANCELLABLE';
  end if;

  perform release_order_stock(o.id);
  delete from coupon_reservations where order_id = o.id;

  update orders
     set status = 'CANCELLED',
         -- Una orden pagada cancelada por el admin conserva su estado de pago
         payment_status = case when o.status = 'CREATED'
                               then 'CANCELLED'::payment_status
                               else payment_status end
   where id = o.id;

  return 'CANCELLED';
end;
$$;

-- =====================================================
-- 4. Expirar órdenes no pagadas y devolver su stock
-- =====================================================
-- Retorna el número de órdenes canceladas.

create or replace function public.expire_stale_orders()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_count int := 0;
begin
  for v_id in
    select id
      from orders
     where status = 'CREATED'
       and stock_reserved
       and reservation_expires_at < now()
     order by reservation_expires_at
     limit 200
     for update skip locked -- no espera a órdenes que otro proceso está tocando
  loop
    if cancel_order(v_id, true) = 'CANCELLED' then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- =====================================================
-- 5. apply_mp_payment: consumir la reserva en vez de descontar de nuevo
-- =====================================================
-- Igual que en 012, salvo el bloque de stock.

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
    else 'PENDING'
  end::payment_status;

  if o.status in ('PAID', 'FULFILLED') then
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

  if o.stock_reserved then
    -- El stock ya se descontó en el checkout: la reserva pasa a ser venta
    update orders
       set stock_reserved = false, reservation_expires_at = null
     where id = o.id;
  else
    -- Órdenes creadas antes de la reserva de stock
    begin
      for it in
        select variant_id, sum(quantity)::int as qty
          from order_items
         where order_id = o.id
         group by variant_id
         order by variant_id
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
  end if;

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
-- 6. Permisos: solo Edge Functions (service_role)
-- =====================================================

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.reserve_order_stock(uuid, int)',
    'public.release_order_stock(uuid)',
    'public.cancel_order(uuid, boolean)',
    'public.expire_stale_orders()',
    'public.apply_mp_payment(text, text, text, bigint, text, bigint, jsonb)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end
$$;

-- =====================================================
-- 7. Programar expiración con pg_cron (si está habilitado)
-- =====================================================
-- Sin pg_cron, create-preference y cleanup-reservations llaman a
-- expire_stale_orders() igualmente.

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid)
       from cron.job where jobname = 'expire-stale-orders';
    perform cron.schedule(
      'expire-stale-orders', '*/5 * * * *', 'select public.expire_stale_orders()'
    );
  end if;
end
$$;

commit;
