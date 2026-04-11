-- =====================================================
-- TRIGGER: validate_discount_code
-- =====================================================
-- Descripción: Valida la consistencia de los campos de descuento
-- Tabla: discount_codes
-- =====================================================

create or replace function validate_discount_code()
returns trigger
language plpgsql
as $$
begin
  -- Validaciones de tipo de descuento
  if new.type = 'PERCENT' then
    if new.value_percent is null or new.value_cents is not null then
      raise exception 'PERCENT requires value_percent and forbids value_cents';
    end if;
  elsif new.type = 'FIXED' then
    if new.value_cents is null or new.value_percent is not null then
      raise exception 'FIXED requires value_cents and forbids value_percent';
    end if;
  elsif new.type = 'FREE_SHIPPING' then
    if new.value_cents is not null or new.value_percent is not null then
      raise exception 'FREE_SHIPPING forbids value_*';
    end if;
  end if;

  -- Validaciones de scope de productos
  if new.applies_to_all_products = true then
    -- Si aplica a todos los productos, los arrays deben ser NULL o vacíos
    if (new.applicable_product_ids is not null and array_length(new.applicable_product_ids, 1) > 0) or
       (new.applicable_category_ids is not null and array_length(new.applicable_category_ids, 1) > 0) then
      raise exception 'applies_to_all_products=true requires applicable_product_ids and applicable_category_ids to be null or empty';
    end if;
  else
    -- Si no aplica a todos, debe tener al menos un producto o categoría específica
    if (new.applicable_product_ids is null or array_length(new.applicable_product_ids, 1) is null or array_length(new.applicable_product_ids, 1) = 0) and
       (new.applicable_category_ids is null or array_length(new.applicable_category_ids, 1) is null or array_length(new.applicable_category_ids, 1) = 0) then
      raise exception 'applies_to_all_products=false requires at least one applicable_product_ids or applicable_category_ids to be specified';
    end if;
  end if;

  return new;
end;
$$;

-- Crear trigger
drop trigger if exists validate_discount_code_trigger on discount_codes;
create trigger validate_discount_code_trigger
  before insert or update on discount_codes
  for each row execute function validate_discount_code();
