-- CH+ PROD hardening - security baseline
-- Run first.

begin;

-- 1) Enforce RLS on temporary coupon reservations.
alter table if exists public.coupon_reservations enable row level security;

drop policy if exists "svc all coupon_reservations" on public.coupon_reservations;
create policy "svc all coupon_reservations"
on public.coupon_reservations
as permissive
for all
to service_role
using (true)
with check (true);

-- 2) Move service policies away from role checks (perf + clarity).
-- products
drop policy if exists "svc all products" on public.products;
create policy "svc all products"
on public.products
as permissive
for all
to service_role
using (true)
with check (true);

-- product_variants
drop policy if exists "svc all variants" on public.product_variants;
drop policy if exists "svc all product_variants" on public.product_variants;
create policy "svc all product_variants"
on public.product_variants
as permissive
for all
to service_role
using (true)
with check (true);

-- categories
drop policy if exists "svc all categories" on public.categories;
create policy "svc all categories"
on public.categories
as permissive
for all
to service_role
using (true)
with check (true);

-- discount_codes
drop policy if exists "svc all discount_codes" on public.discount_codes;
create policy "svc all discount_codes"
on public.discount_codes
as permissive
for all
to service_role
using (true)
with check (true);

-- orders
drop policy if exists "svc all orders" on public.orders;
create policy "svc all orders"
on public.orders
as permissive
for all
to service_role
using (true)
with check (true);

-- order_items
drop policy if exists "svc all order_items" on public.order_items;
create policy "svc all order_items"
on public.order_items
as permissive
for all
to service_role
using (true)
with check (true);

-- order_discounts
drop policy if exists "svc all order_discounts" on public.order_discounts;
create policy "svc all order_discounts"
on public.order_discounts
as permissive
for all
to service_role
using (true)
with check (true);

-- 3) Remove SECURITY DEFINER exposure from catalog view.
alter view public.catalog set (security_invoker = true);

-- 4) Pin search_path in security-sensitive functions.
do $$
declare
  fn text;
begin
  for fn in
    select format(
      'alter function %I.%I(%s) set search_path = public, pg_temp',
      n.nspname,
      p.proname,
      pg_get_function_identity_arguments(p.oid)
    )
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
  loop
    execute fn;
  end loop;
end;
$$;

commit;
