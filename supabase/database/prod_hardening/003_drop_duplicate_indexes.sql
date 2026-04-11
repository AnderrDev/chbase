-- CH+ PROD hardening - drop duplicate indexes
-- Run third (low traffic recommended).

drop index if exists public.uq_variants_sku_active;
drop index if exists public.uq_products_slug_active;
drop index if exists public.idx_products_tags;
