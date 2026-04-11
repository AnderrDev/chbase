begin;

drop view if exists catalog cascade;

create or replace view catalog as
with v_active as (
  select *
  from product_variants
  where is_active = true
    and deleted_at is null
)
select
  p.id          as product_id,
  p.slug,
  p.name,
  p.description,
  p.long_description,
  p.images      as product_images,
  p.features,
  p.ingredients,
  p.nutrition_facts,
  p.tags,
  p.is_featured,
  p.is_active,
  p.store,
  p.category_id,
  c.name        as category_name,

  jsonb_agg(
    jsonb_build_object(
      'variant_id', v.id,
      'label', v.label,
      'sku', v.sku,
      'flavor', v.flavor,
      'size', v.size,
      'options', v.options,
      'price_cents', v.price_cents,
      'compare_at_price_cents', v.compare_at_price_cents,
      'currency', v.currency,
      'stock', v.in_stock,
      'low_stock_threshold', v.low_stock_threshold,
      'is_active', v.is_active,
      'is_default', v.is_default,
      'position', v.position,
      'images', v.images
    )
    order by v.position asc, v.price_cents asc, v.label asc
  ) filter (where v.id is not null) as variants,

  min(v.price_cents) filter (where v.id is not null) as min_price_cents,
  min(v.compare_at_price_cents) filter (where v.compare_at_price_cents is not null) as min_compare_at_price_cents,

  array_agg(v.id) filter (where v.id is not null) as variant_ids,

  (select v1.id from v_active v1
    where v1.product_id = p.id and v1.is_default is true
    order by v1.position asc, v1.price_cents asc limit 1) as default_variant_id,

  coalesce(
    (select v1.price_cents from v_active v1
      where v1.product_id = p.id and v1.is_default is true
      order by v1.position asc, v1.price_cents asc limit 1),
    (select v2.price_cents from v_active v2
      where v2.product_id = p.id
      order by v2.position asc, v2.price_cents asc limit 1)
  ) as default_price_cents,

  coalesce(
    (select v1.compare_at_price_cents from v_active v1
      where v1.product_id = p.id and v1.is_default is true
      order by v1.position asc, v1.price_cents asc limit 1),
    (select v2.compare_at_price_cents from v_active v2
      where v2.product_id = p.id
      order by v2.position asc, v2.price_cents asc limit 1)
  ) as default_compare_at_price_cents,

  coalesce(
    (select v1.sku from v_active v1
      where v1.product_id = p.id and v1.is_default is true
      order by v1.position asc, v1.price_cents asc limit 1),
    (select v2.sku from v_active v2
      where v2.product_id = p.id
      order by v2.position asc, v2.price_cents asc limit 1)
  ) as default_sku,

  coalesce(
    (select v1.label from v_active v1
      where v1.product_id = p.id and v1.is_default is true
      order by v1.position asc, v1.price_cents asc limit 1),
    (select v2.label from v_active v2
      where v2.product_id = p.id
      order by v2.position asc, v2.price_cents asc limit 1)
  ) as default_variant_label,

  coalesce(
    (select v1.images from v_active v1
      where v1.product_id = p.id and v1.is_default is true
      order by v1.position asc, v1.price_cents asc limit 1),
    (select v2.images from v_active v2
      where v2.product_id = p.id
      order by v2.position asc, v2.price_cents asc limit 1),
    p.images
  ) as default_images

from products p
left join v_active v on v.product_id = p.id
left join categories c on c.id = p.category_id
where p.is_active = true
  and p.deleted_at is null
group by
  p.id, p.slug, p.name, p.description, p.long_description,
  p.images, p.features, p.ingredients, p.nutrition_facts, p.tags, p.is_featured, p.is_active, p.store,
  p.category_id, c.name;

commit;
