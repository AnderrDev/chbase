-- CH+ PROD optimization - remove per-row auth eval in service policies
-- Run after 001.

begin;

-- customers
drop policy if exists "svc all customers" on public.customers;
create policy "svc all customers"
on public.customers
as permissive
for all
to service_role
using (true)
with check (true);

-- discount_redemptions
drop policy if exists "svc all discount_redemptions" on public.discount_redemptions;
create policy "svc all discount_redemptions"
on public.discount_redemptions
as permissive
for all
to service_role
using (true)
with check (true);

commit;
