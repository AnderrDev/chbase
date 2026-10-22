-- 005_lock_down_rpcs_and_coupons.sql
-- Idempotente: se puede ejecutar varias veces.
--
-- 1) RPCs internas: Postgres concede EXECUTE a PUBLIC por defecto y Supabase
--    además a anon/authenticated, así que PostgREST las expone en
--    /rest/v1/rpc/<nombre> con la anon key. Las de abajo son SECURITY DEFINER
--    (saltan RLS) o gestionan stock/cupones, y solo deben llamarlas las Edge
--    Functions con service_role.
-- 2) discount_codes: la policy "public read discount_codes" permitía listar
--    todos los cupones activos con la anon key. La validación ya pasa por las
--    Edge Functions (service_role), que no dependen de esa policy.

begin;

do $$
declare
  fn record;
begin
  for fn in
    select n.nspname as schema_name,
           p.proname as func_name,
           pg_get_function_identity_arguments(p.oid) as args,
           p.prosecdef as is_definer
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        -- SECURITY DEFINER
        'decrement_inventory_safe',
        'create_product_with_variants',
        'product_upsert_full',
        -- stock / cupones (solo Edge Functions)
        'check_coupon_availability',
        'create_coupon_reservation',
        'confirm_coupon_reservation',
        'release_coupon_reservation',
        'cleanup_expired_reservations'
      )
  loop
    execute format(
      'revoke execute on function %I.%I(%s) from public, anon, authenticated',
      fn.schema_name, fn.func_name, fn.args
    );
    execute format(
      'grant execute on function %I.%I(%s) to service_role',
      fn.schema_name, fn.func_name, fn.args
    );
    -- product_upsert_full faltaba en 001_security_hardening
    if fn.is_definer then
      execute format(
        'alter function %I.%I(%s) set search_path = public, pg_temp',
        fn.schema_name, fn.func_name, fn.args
      );
    end if;
  end loop;
end
$$;

drop policy if exists "public read discount_codes" on public.discount_codes;

commit;

-- Verificación (debe devolver false en anon_can_execute para todas):
-- select p.proname,
--        has_function_privilege('anon', p.oid, 'execute') as anon_can_execute
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public'
--   and p.proname in ('decrement_inventory_safe', 'create_product_with_variants',
--                     'product_upsert_full', 'create_coupon_reservation');
--
-- select policyname from pg_policies where tablename = 'discount_codes';
