-- =====================================================
-- TRIGGER: normalize_slug
-- =====================================================
-- Descripción: Normaliza slugs antes de insertar/actualizar
-- Tabla: products
-- =====================================================

create or replace function normalize_slug()
returns trigger
language plpgsql
as $$
begin
  if new.slug is not null then
    new.slug := lower(regexp_replace(new.slug, '\s+', '-', 'g'));
  end if;
  return new;
end;
$$;

-- Crear trigger
drop trigger if exists normalize_slug_trigger on products;
create trigger normalize_slug_trigger
  before insert or update on products
  for each row execute function normalize_slug();
