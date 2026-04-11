-- CH+ PROD hardening - post-deploy validation queries

-- 1) Note: run Supabase Advisors (security/performance) after applying.

-- 2) RLS status
select schemaname, tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in (
    'coupon_reservations','products','product_variants','categories',
    'discount_codes','orders','order_items','order_discounts'
  )
order by tablename;

-- 3) Policies of interest
select schemaname, tablename, policyname, roles, cmd
from pg_policies
where schemaname='public'
  and tablename in (
    'coupon_reservations','products','product_variants','categories',
    'discount_codes','orders','order_items','order_discounts'
  )
order by tablename, policyname;

-- 4) security_invoker on catalog
select c.relname as view_name,
       coalesce((select option_value
                 from pg_options_to_table(c.reloptions)
                 where option_name = 'security_invoker'), 'false') as security_invoker
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'catalog'
  and c.relkind = 'v';

-- 5) function search_path
select n.nspname as schema,
       p.proname as function_name,
       coalesce(array_to_string(p.proconfig, ', '), '') as proconfig
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'decrement_inventory_safe',
    'check_coupon_availability',
    'create_coupon_reservation',
    'confirm_coupon_reservation',
    'create_product_with_variants',
    'validate_discount_code',
    'cleanup_expired_reservations',
    'release_coupon_reservation'
  )
order by p.proname;

-- 6) FK indexes and duplicate index cleanup
select schemaname, tablename, indexname
from pg_indexes
where schemaname='public'
  and (
    indexname in (
      'idx_discount_redemptions_customer_id',
      'idx_discount_redemptions_discount_id',
      'idx_discount_redemptions_order_id',
      'idx_order_discounts_discount_id',
      'idx_order_items_product_id',
      'idx_order_items_variant_id'
    )
    or indexname in (
      'uq_variants_sku_active',
      'uq_products_slug_active',
      'idx_products_tags'
    )
  )
order by tablename, indexname;
