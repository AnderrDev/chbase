-- =====================================================
-- RPC: product_upsert_full
-- =====================================================
-- Descripción: Upsert completo de producto con variantes
-- Parámetros: p_payload (jsonb), p_prune_missing (boolean)
-- Retorna: uuid (product_id)
-- =====================================================

create or replace function product_upsert_full(
  p_payload jsonb,
  p_prune_missing boolean default false
)
returns uuid
language plpgsql
security definer
as $$
declare
  pid uuid;
  v jsonb;
  v_id uuid;
  keep_ids uuid[] := '{}'::uuid[];
  keep_skus text[] := '{}'::text[];
begin
  -- upsert producto
  if (p_payload ? 'id') then
    pid := (p_payload->>'id')::uuid;
    update products
      set name = coalesce(p_payload->>'name', name),
          slug = coalesce(p_payload->>'slug', slug),
          description = coalesce(p_payload->>'description', description),
          long_description = coalesce(p_payload->>'long_description', long_description),
          images = coalesce(p_payload->'images', images),
          features = coalesce((select array(select jsonb_array_elements_text(p_payload->'features'))), features),
          ingredients = coalesce((select array(select jsonb_array_elements_text(p_payload->'ingredients'))), ingredients),
          nutrition_facts = coalesce(p_payload->'nutrition_facts', nutrition_facts),
          tags = coalesce((select array(select jsonb_array_elements_text(p_payload->'tags'))), tags),
          seo_title = coalesce(p_payload->>'seo_title', seo_title),
          seo_description = coalesce(p_payload->>'seo_description', seo_description),
          category_id = coalesce((p_payload->>'category_id')::uuid, category_id),
          is_featured = coalesce((p_payload->>'is_featured')::boolean, is_featured),
          is_active = coalesce((p_payload->>'is_active')::boolean, is_active),
          store = coalesce(p_payload->>'store', store), -- Agregar campo store
          updated_at = now()
    where id = pid;
    if not found then
      raise exception 'product % not found', pid;
    end if;
  else
    insert into products(
      name, slug, description, long_description, images, features, ingredients,
      nutrition_facts, tags, seo_title, seo_description, category_id,
      is_featured, is_active, store
    )
    values(
      p_payload->>'name',
      p_payload->>'slug',
      p_payload->>'description',
      p_payload->>'long_description',
      p_payload->'images',
      coalesce((select array(select jsonb_array_elements_text(p_payload->'features'))), '{}'),
      coalesce((select array(select jsonb_array_elements_text(p_payload->'ingredients'))), '{}'),
      coalesce(p_payload->'nutrition_facts','{}'::jsonb),
      coalesce((select array(select jsonb_array_elements_text(p_payload->'tags'))), '{}'),
      p_payload->>'seo_title',
      p_payload->>'seo_description',
      (p_payload->>'category_id')::uuid,
      coalesce((p_payload->>'is_featured')::boolean, false),
      coalesce((p_payload->>'is_active')::boolean, true),
      coalesce(p_payload->>'store', 'CH+') -- Agregar campo store
    )
    returning id into pid;
  end if;

  -- upsert variantes
  if p_payload ? 'variants' then
    for v in select * from jsonb_array_elements(p_payload->'variants')
    loop
      -- normaliza sku
      v := v || jsonb_build_object('sku', upper(regexp_replace(coalesce(v->>'sku',''), '\s+', '-', 'g')));

      if v ? 'id' then
        v_id := null;
        update product_variants set
          sku = coalesce(v->>'sku', sku),
          label = coalesce(v->>'label', label),
          flavor = coalesce(v->>'flavor', flavor),
          size = coalesce(v->>'size', size),
          options = coalesce(v->'options', options),
          price_cents = coalesce((v->>'price_cents')::int, price_cents),
          compare_at_price_cents = coalesce((v->>'compare_at_price_cents')::int, compare_at_price_cents),
          currency = coalesce(v->>'currency', currency),
          in_stock = coalesce((v->>'in_stock')::int, in_stock),
          low_stock_threshold = coalesce((v->>'low_stock_threshold')::int, low_stock_threshold),
          weight_grams = coalesce((v->>'weight_grams')::int, weight_grams),
          dimensions = coalesce(v->'dimensions', dimensions),
          images = coalesce(v->'images', images),
          position = coalesce((v->>'position')::int, position),
          is_default = coalesce((v->>'is_default')::boolean, is_default),
          is_active = coalesce((v->>'is_active')::boolean, is_active),
          updated_at = now()
        where id = (v->>'id')::uuid
          and product_id = pid
        returning id into v_id;

        if v_id is not null then
          keep_ids := keep_ids || v_id;
        end if;
      else
        v_id := null;
        insert into product_variants(
          product_id, sku, label, flavor, size, options, price_cents, compare_at_price_cents,
          currency, in_stock, low_stock_threshold, weight_grams, dimensions, images,
          position, is_default, is_active
        )
        values (
          pid,
          v->>'sku',
          v->>'label',
          v->>'flavor',
          v->>'size',
          v->'options',
          (v->>'price_cents')::int,
          (v->>'compare_at_price_cents')::int,
          coalesce(v->>'currency','COP'),
          coalesce((v->>'in_stock')::int,0),
          coalesce((v->>'low_stock_threshold')::int,5),
          (v->>'weight_grams')::int,
          v->'dimensions',
          v->'images',
          coalesce((v->>'position')::int,0),
          coalesce((v->>'is_default')::boolean,false),
          coalesce((v->>'is_active')::boolean,true)
        )
        returning id into v_id;

        keep_ids := keep_ids || v_id;
      end if;

      keep_skus := keep_skus || (v->>'sku');
    end loop;

    if p_prune_missing then
      -- marcar como soft-delete lo que no venga en la carga
      update product_variants
         set deleted_at = now(), is_active = false, updated_at = now()
       where product_id = pid
         and deleted_at is null
         and (array_length(keep_ids,1)  is null or not (id  = any(keep_ids)))
         and (array_length(keep_skus,1) is null or not (sku = any(keep_skus)));
    end if;
  end if;

  return pid;
end;
$$;

-- Grant execute permission to service role
grant execute on function product_upsert_full(jsonb, boolean) to service_role;
