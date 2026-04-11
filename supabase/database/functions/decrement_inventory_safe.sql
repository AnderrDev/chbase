-- =====================================================
-- RPC: decrement_inventory_safe
-- =====================================================
-- Descripción: Decrementa inventario de forma segura con validaciones
-- Parámetros: p_variant_id (uuid), p_qty (int)
-- Retorna: void
-- =====================================================

create or replace function decrement_inventory_safe(
  p_variant_id uuid,
  p_qty int
)
returns void
language plpgsql
security definer
as $$
declare affected int;
begin
  if p_qty <= 0 then
    raise exception 'Quantity must be positive';
  end if;

  update product_variants
     set in_stock = in_stock - p_qty, updated_at = now()
   where id = p_variant_id
     and is_active = true
     and deleted_at is null
     and in_stock >= p_qty
  returning 1 into affected;

  if affected is null then
    raise exception 'Not enough stock or invalid variant %', p_variant_id;
  end if;
end;
$$;

-- Grant execute permission to service role
grant execute on function decrement_inventory_safe(uuid, int) to service_role;
