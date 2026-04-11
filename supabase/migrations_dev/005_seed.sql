begin;

-- Productos (con categorías asignadas)
insert into products (slug, name, type, description, long_description, images, is_featured, category_id)
values
('creatina-monohidratada', 'Creatina Monohidratada CH+', 'creatine',
 'Creatina pura para mejorar fuerza y rendimiento',
 'La creatina monohidratada CH+ ayuda a mejorar fuerza, resistencia y recuperación.',
 '["https://picsum.photos/seed/crea1/800/800"]'::jsonb, true,
 (select id from categories where name = 'Creatinas')),

('creatina-micronizada', 'Creatina Micronizada CH+', 'creatine',
 'Creatina micronizada para mejor absorción',
 'Absorción más rápida y efectiva para optimizar rendimiento.',
 '["https://picsum.photos/seed/crea2/800/800"]'::jsonb, false,
 (select id from categories where name = 'Creatinas')),

('proteina-whey', 'Proteína Whey CH+', 'protein',
 'Whey concentrada para ganar masa muscular',
 'Recuperación y crecimiento muscular altos en aminoácidos esenciales.',
 '["https://picsum.photos/seed/prot1/800/800"]'::jsonb, true,
 (select id from categories where name = 'Proteínas')),

('proteina-isolate', 'Proteína Isolate CH+', 'protein',
 'Aislada de rápida absorción',
 'Ideal post-entreno, baja en carbos y grasas.',
 '["https://picsum.photos/seed/prot2/800/800"]'::jsonb, false,
 (select id from categories where name = 'Proteínas'));

-- Variantes (con precio/stock e imágenes por variante)
-- Creatina Monohidratada
insert into product_variants (product_id, sku, label, flavor, size, price_cents, compare_at_price_cents, in_stock, is_default, images, position)
select id, 'CREA-MONO-300', '300g', 'Natural', '300g', 85000, 95000, 50, true,
       '["https://picsum.photos/seed/crea300/800/800","https://picsum.photos/seed/crea300b/800/800"]'::jsonb, 0
from products where slug = 'creatina-monohidratada';

insert into product_variants (product_id, sku, label, flavor, size, price_cents, compare_at_price_cents, in_stock, images, position)
select id, 'CREA-MONO-500', '500g', 'Natural', '500g', 120000, 130000, 30,
       '["https://picsum.photos/seed/crea500/800/800"]'::jsonb, 1
from products where slug = 'creatina-monohidratada';

-- Creatina Micronizada
insert into product_variants (product_id, sku, label, flavor, size, price_cents, compare_at_price_cents, in_stock, is_default, images)
select id, 'CREA-MICRO-300', '300g', 'Natural', '300g', 95000, 105000, 40, true,
       '["https://picsum.photos/seed/creaM300/800/800"]'::jsonb
from products where slug = 'creatina-micronizada';

-- Whey
insert into product_variants (product_id, sku, label, flavor, size, price_cents, compare_at_price_cents, in_stock, is_default, images, position)
select id, 'WHEY-VAIN-1KG', '1Kg Vainilla', 'Vainilla', '1Kg', 120000, 135000, 60, true,
       '["https://picsum.photos/seed/wheyv/800/800"]'::jsonb, 0
from products where slug = 'proteina-whey';

insert into product_variants (product_id, sku, label, flavor, size, price_cents, compare_at_price_cents, in_stock, images, position)
select id, 'WHEY-CHOCO-1KG', '1Kg Chocolate', 'Chocolate', '1Kg', 120000, 135000, 45,
       '["https://picsum.photos/seed/wheyc/800/800"]'::jsonb, 1
from products where slug = 'proteina-whey';

-- Isolate
insert into product_variants (product_id, sku, label, flavor, size, price_cents, compare_at_price_cents, in_stock, is_default, images)
select id, 'ISO-VAIN-900', '900g Vainilla', 'Vainilla', '900g', 145000, 160000, 25, true,
       '["https://picsum.photos/seed/isov/800/800"]'::jsonb
from products where slug = 'proteina-isolate';

-- =========================
-- CÓDIGOS DE DESCUENTO DE PRUEBA
-- =========================

-- Descuento del 10% en toda la compra
insert into discount_codes (code, type, value_percent, min_order_cents, is_active)
values ('CHPLUS10', 'PERCENT', 10, 50000, true);

-- Descuento fijo de $20,000 en compras mayores a $100,000
insert into discount_codes (code, type, value_cents, min_order_cents, is_active)
values ('CHPLUS20K', 'FIXED', 20000, 100000, true);

-- Envío gratis en compras mayores a $150,000
insert into discount_codes (code, type, min_order_cents, is_active)
values ('ENVIOGRATIS', 'FREE_SHIPPING', 150000, true);

-- Descuento del 15% en creatinas (sin mínimo)
insert into discount_codes (code, type, value_percent, is_active)
values ('CREATINA15', 'PERCENT', 15, true);

-- Descuento fijo de $10,000 (sin mínimo)
insert into discount_codes (code, type, value_cents, is_active)
values ('CHPLUS10K', 'FIXED', 10000, true);

commit;
