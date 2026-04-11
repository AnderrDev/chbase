-- =====================================================
-- TRIGGER: sync_total_cents
-- =====================================================
-- Descripción: Calcula automáticamente el total de la orden
-- Tabla: orders
-- =====================================================

create or replace function sync_total_cents()
returns trigger
language plpgsql
as $$
begin
  new.total_cents := greatest(0, coalesce(new.subtotal_cents,0) + coalesce(new.shipping_cents,0) - coalesce(new.discount_cents,0));
  return new;
end;
$$;

-- Crear trigger
drop trigger if exists sync_total_cents_trigger on orders;
create trigger sync_total_cents_trigger
  before insert or update on orders
  for each row execute function sync_total_cents();
