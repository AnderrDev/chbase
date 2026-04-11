-- =====================================================
-- TRIGGER: set_updated_at
-- =====================================================
-- Descripción: Actualiza automáticamente el campo updated_at
-- Tablas: products, product_variants, orders, etc.
-- =====================================================

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Crear triggers para todas las tablas relevantes
drop trigger if exists set_updated_at_products on products;
create trigger set_updated_at_products
  before update on products
  for each row execute function set_updated_at();

drop trigger if exists set_updated_at_product_variants on product_variants;
create trigger set_updated_at_product_variants
  before update on product_variants
  for each row execute function set_updated_at();

drop trigger if exists set_updated_at_orders on orders;
create trigger set_updated_at_orders
  before update on orders
  for each row execute function set_updated_at();
