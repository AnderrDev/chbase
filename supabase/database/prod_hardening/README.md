# CH+ Production Hardening

Archivos en orden de ejecucion:

1. `001_security_hardening.sql`
2. `002_fk_indexes.sql`
3. `003_drop_duplicate_indexes.sql`
4. `004_rls_perf_cleanup.sql`
5. `005_lock_down_rpcs_and_coupons.sql` (revoca RPCs internas a anon/authenticated y quita la lectura pública de cupones)
6. `010_validation.sql`

## Ejecucion manual

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/database/prod_hardening/001_security_hardening.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/database/prod_hardening/002_fk_indexes.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/database/prod_hardening/003_drop_duplicate_indexes.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/database/prod_hardening/005_lock_down_rpcs_and_coupons.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/database/prod_hardening/010_validation.sql
```

## Ejecucion con script

```bash
./scripts/chplus-prod-hardening.sh plan
./scripts/chplus-prod-hardening.sh apply
```

## Checklist post-ejecucion

- Ejecutar advisors de seguridad y performance en Supabase.
- Probar `create-preference`, `mp-webhook`, `order-status`, `validate-coupon`, `validate-cart-stock`, `related-products`.
- Revisar logs de `postgres`, `api`, `edge-function`.
