# CH+ Prod Hardening Report (2026-04-07)

## Alcance ejecutado

- Proyecto Supabase: `iqeuktsyzrkrbkjiqfvy` (CH+ prod).
- Migraciones aplicadas:
  - `security_hardening_chplus_prod`
  - `fk_indexes_chplus_prod`
  - `drop_duplicate_indexes_chplus_prod`

## Antes vs despues

### Seguridad

- Antes: `public.catalog` con `SECURITY DEFINER` (advisor ERROR).
- Despues: `public.catalog` con `security_invoker=true`.

- Antes: `public.coupon_reservations` sin RLS (advisor ERROR).
- Despues: RLS habilitado + policy `svc all coupon_reservations` para `service_role`.

- Antes: funciones criticas sin `search_path` fijo.
- Despues: funciones criticas con `search_path=public, pg_temp`:
  - `check_coupon_availability`
  - `cleanup_expired_reservations`
  - `confirm_coupon_reservation`
  - `create_coupon_reservation`
  - `create_product_with_variants`
  - `decrement_inventory_safe`
  - `release_coupon_reservation`
  - `validate_discount_code`

### Performance

- Antes: FKs sin indice en `discount_redemptions`, `order_discounts`, `order_items`.
- Despues: indices creados:
  - `idx_discount_redemptions_customer_id`
  - `idx_discount_redemptions_discount_id`
  - `idx_discount_redemptions_order_id`
  - `idx_order_discounts_discount_id`
  - `idx_order_items_product_id`
  - `idx_order_items_variant_id`

- Antes: indices duplicados detectados por advisor.
- Despues: eliminados:
  - `uq_variants_sku_active`
  - `uq_products_slug_active`
  - `idx_products_tags`

## Smoke tests ejecutados

- `GET /functions/v1/mp-webhook?test=true` -> `200`.
- `GET /functions/v1/order-status?order_number=CH_TEST_NOT_FOUND` -> `404` esperado.
- `POST /functions/v1/validate-coupon` (codigo invalido) -> `200` con `valid:false`.
- `POST /functions/v1/validate-cart-stock` (variant real) -> `200`.
- `POST /functions/v1/related-products` -> `200`.
- `POST /functions/v1/create-preference` (payload vacio) -> `400` esperado por validacion.

## Pendientes no criticos

- Security WARN: funciones legacy aun sin `search_path` fijo (`normalize_slug`, `normalize_sku`, `sync_total_cents`, `product_upsert_full`, `trigger_cleanup_expired_reservations`, `set_updated_at`, `uppercase_code`).
- Security WARN: extension `pg_trgm` instalada en `public`.
- Security WARN: version de Postgres con parches disponibles (upgrade recomendado por Supabase).
- Performance INFO: varios `unused_index` (normal despues de crearlos; reevaluar tras trafico real).
- Performance WARN: `auth_rls_initplan` en tablas fuera del paquete principal (`customers`, `discount_redemptions`) y potencial refactor fino de policies.

## Archivos de soporte

- `supabase/database/prod_hardening/001_security_hardening.sql`
- `supabase/database/prod_hardening/002_fk_indexes.sql`
- `supabase/database/prod_hardening/003_drop_duplicate_indexes.sql`
- `supabase/database/prod_hardening/010_validation.sql`
- `scripts/chplus-prod-hardening.sh`
