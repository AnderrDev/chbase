-- CH+ PROD hardening - missing FK indexes
-- Run second.

create index if not exists idx_discount_redemptions_customer_id
  on public.discount_redemptions (customer_id);

create index if not exists idx_discount_redemptions_discount_id
  on public.discount_redemptions (discount_id);

create index if not exists idx_discount_redemptions_order_id
  on public.discount_redemptions (order_id);

create index if not exists idx_order_discounts_discount_id
  on public.order_discounts (discount_id);

create index if not exists idx_order_items_product_id
  on public.order_items (product_id);

create index if not exists idx_order_items_variant_id
  on public.order_items (variant_id);
