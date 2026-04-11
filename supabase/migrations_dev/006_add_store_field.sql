-- Add store field to products table
-- This migration adds support for multi-store functionality (CH+ and MoveOn)

begin;

-- Add store field to products table
alter table products 
add column store text not null default 'CH+' check (store in ('CH+', 'MoveOn'));

-- Add constraint to ensure only valid store values
alter table products 
add constraint check_store_values check (store in ('CH+', 'MoveOn'));

-- Add index for query performance
create index if not exists idx_products_store on products(store);

-- Update existing products to have CH+ as default (they already have the default value)
-- This is just for documentation - the default value is already applied

commit;
