-- Update create_product_with_variants RPC to handle store field
-- This migration updates the existing RPC to include the store field

begin;

-- Update the RPC function to handle store field
create or replace function create_product_with_variants(p_payload jsonb)
returns jsonb
language plpgsql
security definer
as $$
declare
  new_product_id uuid;
  new_variant_ids uuid[];
begin
  -- Inserta el producto CON el campo store
  insert into products (
    name, slug, description, long_description, images, features, ingredients, nutrition_facts,
    is_featured, is_active, category_id, store
  )
  values (
    p_payload->'product'->>'name',
    p_payload->'product'->>'slug',
    p_payload->'product'->>'description',
    p_payload->'product'->>'long_description',
    coalesce((p_payload->'product'->'images')::jsonb, '[]'::jsonb),

    -- features
    case 
      when p_payload->'product'->'features' is null then '{}'
      when jsonb_array_length(p_payload->'product'->'features') = 0 then '{}'
      else array(
        select value::text
        from jsonb_array_elements_text(p_payload->'product'->'features')
      )
    end,

    -- ingredients
    case 
      when p_payload->'product'->'ingredients' is null then '{}'
      when jsonb_array_length(p_payload->'product'->'ingredients') = 0 then '{}'
      else array(
        select value::text
        from jsonb_array_elements_text(p_payload->'product'->'ingredients')
      )
    end,

    coalesce((p_payload->'product'->'nutrition_facts')::jsonb, '{}'::jsonb),
    coalesce((p_payload->'product'->>'is_featured')::boolean, false),
    coalesce((p_payload->'product'->>'is_active')::boolean, true),
    nullif(p_payload->'product'->>'category_id','')::uuid,
    -- AQUÍ ESTÁ EL CAMBIO: agregar el campo store
    coalesce(p_payload->'product'->>'store', 'CH+')
  )
  returning id into new_product_id;

  -- Inserta variantes y obtiene IDs como array
  with inserted as (
    insert into product_variants (
      product_id, sku, label, flavor, size, price_cents, compare_at_price_cents,
      in_stock, low_stock_threshold, is_default, is_active, images
    )
    select
      new_product_id,
      v->>'sku',
      v->>'label',
      nullif(v->>'flavor',''),
      nullif(v->>'size',''),
      (v->>'price_cents')::int,
      nullif(v->>'compare_at_price_cents','')::int,
      coalesce((v->>'in_stock')::int, 0),
      coalesce((v->>'low_stock_threshold')::int, 5),
      coalesce((v->>'is_default')::boolean, false),
      true,
      coalesce((v->'images')::jsonb, '[]'::jsonb)
    from jsonb_array_elements(p_payload->'variants') v
    returning id
  )
  select array_agg(id) into new_variant_ids from inserted;

  -- Devuelve JSON con producto + array de variantes
  return jsonb_build_object(
    'product_id', new_product_id,
    'variant_ids', new_variant_ids
  );
end;
$$;

-- Grant execute permission to service role
grant execute on function create_product_with_variants(jsonb) to service_role;

commit;
