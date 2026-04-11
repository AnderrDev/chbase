-- =====================================================
-- TRIGGER: uppercase_code
-- =====================================================
-- Descripción: Convierte códigos a mayúsculas
-- Tabla: discount_codes
-- =====================================================

create or replace function uppercase_code()
returns trigger
language plpgsql
as $$
begin
  if new.code is not null then
    new.code := upper(new.code);
  end if;
  return new;
end;
$$;

-- Crear trigger
drop trigger if exists uppercase_code_trigger on discount_codes;
create trigger uppercase_code_trigger
  before insert or update on discount_codes
  for each row execute function uppercase_code();
