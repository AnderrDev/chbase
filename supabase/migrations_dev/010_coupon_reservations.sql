-- =====================================================
-- MIGRATION: 010_coupon_reservations.sql
-- =====================================================
-- Descripción: Sistema de reserva temporal de cupones
-- Fecha: 2024
-- =====================================================

begin;

-- =====================================================
-- 1. Crear tabla de reservas temporales de cupones
-- =====================================================

create table if not exists coupon_reservations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  discount_id uuid not null references discount_codes(id),
  code_snapshot text not null,
  type_snapshot discount_type not null,
  value_percent_snapshot int,
  value_cents_snapshot int,
  amount_applied_cents int not null default 0,
  currency text not null default 'COP' check (currency = 'COP'),
  expires_at timestamptz not null, -- Reserva expira en 30 minutos
  created_at timestamptz not null default now()
);

-- =====================================================
-- 2. Crear índices para búsquedas eficientes
-- =====================================================

create index if not exists idx_coupon_reservations_order 
on coupon_reservations(order_id);

create index if not exists idx_coupon_reservations_discount 
on coupon_reservations(discount_id);

create index if not exists idx_coupon_reservations_expires 
on coupon_reservations(expires_at);

-- =====================================================
-- 3. Función para limpiar reservas expiradas
-- =====================================================

create or replace function cleanup_expired_reservations()
returns void language plpgsql as $$
begin
  delete from coupon_reservations 
  where expires_at < now();
end;
$$;

-- =====================================================
-- 4. Función para verificar disponibilidad con reservas
-- =====================================================

create or replace function check_coupon_availability(
  p_discount_id uuid,
  p_max_redemptions_total int default null
)
returns boolean language plpgsql as $$
declare
  current_redemptions int;
  current_reservations int;
begin
  -- Si no hay límite, siempre disponible
  if p_max_redemptions_total is null then
    return true;
  end if;
  
  -- Contar redemptions confirmados (order_discounts)
  select count(*) into current_redemptions
  from order_discounts 
  where discount_id = p_discount_id;
  
  -- Contar reservas activas (no expiradas)
  select count(*) into current_reservations
  from coupon_reservations 
  where discount_id = p_discount_id 
  and expires_at > now();
  
  -- Verificar si hay espacio disponible
  return (current_redemptions + current_reservations) < p_max_redemptions_total;
end;
$$;

-- =====================================================
-- 5. Función para crear reserva temporal
-- =====================================================

create or replace function create_coupon_reservation(
  p_order_id uuid,
  p_discount_id uuid,
  p_code_snapshot text,
  p_type_snapshot discount_type,
  p_value_percent_snapshot int default null,
  p_value_cents_snapshot int default null,
  p_amount_applied_cents int default 0,
  p_currency text default 'COP'
)
returns uuid language plpgsql as $$
declare
  reservation_id uuid;
  expires_at timestamptz;
begin
  -- Reserva expira en 30 minutos
  expires_at := now() + interval '30 minutes';
  
  -- Crear reserva
  insert into coupon_reservations (
    order_id,
    discount_id,
    code_snapshot,
    type_snapshot,
    value_percent_snapshot,
    value_cents_snapshot,
    amount_applied_cents,
    currency,
    expires_at
  ) values (
    p_order_id,
    p_discount_id,
    p_code_snapshot,
    p_type_snapshot,
    p_value_percent_snapshot,
    p_value_cents_snapshot,
    p_amount_applied_cents,
    p_currency,
    expires_at
  ) returning id into reservation_id;
  
  return reservation_id;
end;
$$;

-- =====================================================
-- 6. Función para confirmar reserva (mover a order_discounts)
-- =====================================================

create or replace function confirm_coupon_reservation(
  p_order_id uuid,
  p_discount_id uuid
)
returns void language plpgsql as $$
declare
  reservation_record coupon_reservations%rowtype;
begin
  -- Obtener datos de la reserva
  select * into reservation_record
  from coupon_reservations 
  where order_id = p_order_id 
  and discount_id = p_discount_id
  and expires_at > now();
  
  if not found then
    raise exception 'Reserva no encontrada o expirada para orden % y cupón %', p_order_id, p_discount_id;
  end if;
  
  -- Crear entrada en order_discounts
  insert into order_discounts (
    order_id,
    discount_id,
    code_snapshot,
    type_snapshot,
    value_percent_snapshot,
    value_cents_snapshot,
    amount_applied_cents,
    currency,
    applies_to_all_products_snapshot,
    applicable_product_ids_snapshot,
    applicable_category_ids_snapshot
  ) values (
    reservation_record.order_id,
    reservation_record.discount_id,
    reservation_record.code_snapshot,
    reservation_record.type_snapshot,
    reservation_record.value_percent_snapshot,
    reservation_record.value_cents_snapshot,
    reservation_record.amount_applied_cents,
    reservation_record.currency,
    true, -- Por ahora, se puede expandir después
    null,
    null
  );
  
  -- Eliminar reserva
  delete from coupon_reservations 
  where id = reservation_record.id;
end;
$$;

-- =====================================================
-- 7. Función para liberar reserva (pago fallido)
-- =====================================================

create or replace function release_coupon_reservation(
  p_order_id uuid,
  p_discount_id uuid
)
returns void language plpgsql as $$
begin
  delete from coupon_reservations 
  where order_id = p_order_id 
  and discount_id = p_discount_id;
end;
$$;

-- =====================================================
-- 8. Crear trigger para limpiar reservas expiradas
-- =====================================================

-- Trigger que se ejecuta cada vez que se accede a la tabla
create or replace function trigger_cleanup_expired_reservations()
returns trigger language plpgsql as $$
begin
  perform cleanup_expired_reservations();
  return coalesce(new, old);
end;
$$;

create trigger cleanup_expired_reservations_trigger
  before insert or update on coupon_reservations
  for each statement execute function trigger_cleanup_expired_reservations();

commit;
