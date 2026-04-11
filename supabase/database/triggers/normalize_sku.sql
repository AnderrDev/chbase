-- =====================================================
-- TRIGGER: normalize_sku
-- =====================================================
-- Descripción: Normaliza SKUs antes de insertar/actualizar
-- Tabla: product_variants
-- =====================================================

create or replace function normalize_sku()
returns trigger
language plpgsql
as $$
begin
  if new.sku is not null then
    new.sku := upper(regexp_replace(new.sku, '\s+', '-', 'g'));
  end if;
  return new;
end;
$$;

-- Crear trigger
drop trigger if exists normalize_sku_trigger on product_variants;
create trigger normalize_sku_trigger
  before insert or update on product_variants
  for each row execute function normalize_sku();
