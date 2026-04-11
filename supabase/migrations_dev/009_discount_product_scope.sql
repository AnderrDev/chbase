-- =====================================================
-- MIGRATION: 009_discount_product_scope.sql
-- =====================================================
-- Descripción: Agregar funcionalidad de cupones para productos específicos
-- Fecha: 2024
-- =====================================================

begin;

-- =====================================================
-- 1. Agregar nuevos campos a discount_codes
-- =====================================================

-- Agregar campos para scope de productos
alter table discount_codes 
add column if not exists applies_to_all_products boolean not null default true,
add column if not exists applicable_product_ids uuid[],
add column if not exists applicable_category_ids uuid[];

-- =====================================================
-- 2. Agregar campos de snapshot a order_discounts
-- =====================================================

-- Agregar campos para snapshot de scope en órdenes
alter table order_discounts 
add column if not exists applies_to_all_products_snapshot boolean not null default true,
add column if not exists applicable_product_ids_snapshot uuid[],
add column if not exists applicable_category_ids_snapshot uuid[];

-- =====================================================
-- 3. Crear índices para búsquedas eficientes
-- =====================================================

-- Índices GIN para arrays de UUIDs
create index if not exists idx_discount_codes_applicable_products 
on discount_codes using gin (applicable_product_ids);

create index if not exists idx_discount_codes_applicable_categories 
on discount_codes using gin (applicable_category_ids);

-- Índices para order_discounts snapshots
create index if not exists idx_order_discounts_applicable_products 
on order_discounts using gin (applicable_product_ids_snapshot);

create index if not exists idx_order_discounts_applicable_categories 
on order_discounts using gin (applicable_category_ids_snapshot);

-- =====================================================
-- 4. Agregar constraints de validación
-- =====================================================

-- Constraint: Si applies_to_all_products = true, los arrays deben ser NULL o vacíos
alter table discount_codes 
add constraint check_applies_to_all_products_consistency 
check (
  (applies_to_all_products = true and 
   (applicable_product_ids is null or array_length(applicable_product_ids, 1) is null) and
   (applicable_category_ids is null or array_length(applicable_category_ids, 1) is null))
  or
  (applies_to_all_products = false and 
   (applicable_product_ids is not null and array_length(applicable_product_ids, 1) > 0) or
   (applicable_category_ids is not null and array_length(applicable_category_ids, 1) > 0))
);

-- =====================================================
-- 5. Migrar datos existentes
-- =====================================================

-- Actualizar todos los cupones existentes para que apliquen a todos los productos
update discount_codes 
set applies_to_all_products = true,
    applicable_product_ids = null,
    applicable_category_ids = null
where applies_to_all_products is null 
   or applicable_product_ids is not null 
   or applicable_category_ids is not null;

-- =====================================================
-- 6. Comentarios de documentación
-- =====================================================

comment on column discount_codes.applies_to_all_products is 'Si true, el cupón aplica a todos los productos. Si false, aplica solo a productos/categorías específicos';
comment on column discount_codes.applicable_product_ids is 'Array de product_ids específicos a los que aplica el cupón (solo si applies_to_all_products = false)';
comment on column discount_codes.applicable_category_ids is 'Array de category_ids específicos a los que aplica el cupón (solo si applies_to_all_products = false)';

comment on column order_discounts.applies_to_all_products_snapshot is 'Snapshot del campo applies_to_all_products al momento de aplicar el descuento';
comment on column order_discounts.applicable_product_ids_snapshot is 'Snapshot del array de product_ids aplicables al momento de aplicar el descuento';
comment on column order_discounts.applicable_category_ids_snapshot is 'Snapshot del array de category_ids aplicables al momento de aplicar el descuento';

commit;
