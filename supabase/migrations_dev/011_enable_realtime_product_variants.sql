-- Habilitar Supabase Realtime para product_variants
-- Permite que el storefront reciba cambios de stock en tiempo real
-- via WebSocket sin polling

ALTER PUBLICATION supabase_realtime ADD TABLE product_variants;
