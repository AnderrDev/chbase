begin;

-- Activar RLS
alter table products enable row level security;
alter table product_variants enable row level security;
alter table categories enable row level security;
alter table discount_codes enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table order_discounts enable row level security;

-- Lectura pública del catálogo (solo activos y no eliminados)
drop policy if exists "public read products" on products;
create policy "public read products" on products
for select using (is_active = true and deleted_at is null);

drop policy if exists "public read variants" on product_variants;
create policy "public read variants" on product_variants
for select using (is_active = true and deleted_at is null);

drop policy if exists "public read categories" on categories;
create policy "public read categories" on categories
for select using (true);


-- Cupones visibles públicamente (opc)
drop policy if exists "public read discount_codes" on discount_codes;
create policy "public read discount_codes" on discount_codes
for select using (is_active = true and (end_at is null or end_at > now()));

-- Escrituras SOLO desde service_role (Edge Functions)
drop policy if exists "svc all products" on products;
create policy "svc all products" on products
for all using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists "svc all variants" on product_variants;
create policy "svc all variants" on product_variants
for all using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists "svc all categories" on categories;
create policy "svc all categories" on categories
for all using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');


drop policy if exists "svc all discount_codes" on discount_codes;
create policy "svc all discount_codes" on discount_codes
for all using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists "svc all orders" on orders;
create policy "svc all orders" on orders
for all using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists "svc all order_items" on order_items;
create policy "svc all order_items" on order_items
for all using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists "svc all order_discounts" on order_discounts;
create policy "svc all order_discounts" on order_discounts
for all using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

commit;
