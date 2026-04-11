begin;

-- =========================
-- ENUMS (compatibles idempotentes)
-- =========================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'discount_type') then
    create type discount_type as enum ('PERCENT','FIXED','FREE_SHIPPING');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'order_status') then
    create type order_status as enum ('CREATED','PAID','FULFILLED','CANCELLED','REFUNDED');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'payment_status') then
    create type payment_status as enum ('PENDING','APPROVED','REJECTED','CANCELLED','REFUNDED');
  end if;
end $$;

-- =========================
-- Helpers
-- =========================
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create or replace function normalize_slug()
returns trigger language plpgsql as $$
begin
  if new.slug is not null then
    new.slug := lower(regexp_replace(new.slug, '\s+', '-', 'g'));
  end if;
  return new;
end $$;

create or replace function normalize_sku()
returns trigger language plpgsql as $$
begin
  if new.sku is not null then
    new.sku := upper(regexp_replace(new.sku, '\s+', '-', 'g'));
  end if;
  return new;
end $$;

create or replace function uppercase_code()
returns trigger language plpgsql as $$
begin
  if new.code is not null then new.code := upper(new.code); end if;
  return new;
end $$;

-- =========================
-- Catálogo
-- =========================
create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  description text,
  long_description text,
  images jsonb,                           -- ['url'] o [{url,alt}]
  features text[] default '{}',
  ingredients text[] default '{}',
  nutrition_facts jsonb default '{}'::jsonb,
  tags text[] default '{}',
  seo_title text,
  seo_description text,
  is_featured boolean default false,
  is_active boolean default true,
  category_id uuid references categories(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz
);


create table if not exists product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  sku text not null unique,
  label text not null,             -- "1Kg Vainilla", "300g", etc.
  flavor text,
  size text,
  options jsonb,                   -- {"Sabor":"Vainilla","Tamaño":"1Kg"} (opcional)
  price_cents int not null check (price_cents >= 0),
  compare_at_price_cents int check (compare_at_price_cents is null or compare_at_price_cents >= price_cents),
  currency text not null default 'COP' check (currency = 'COP'),
  in_stock int not null default 0 check (in_stock >= 0),
  low_stock_threshold int default 5,
  weight_grams int,
  dimensions jsonb,                -- {"w_mm":120,"h_mm":200,"d_mm":120} (opcional)
  images jsonb,                    -- imágenes propias de la variante
  position int default 0,
  is_default boolean,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz
);

-- una sola default por producto (ignorando borrados lógicos)
create unique index if not exists ux_variant_default_per_product
  on product_variants(product_id)
  where is_default is true and deleted_at is null;

-- Índices útiles
create index if not exists idx_products_slug on products(slug);
create index if not exists idx_products_active on products(is_active) where deleted_at is null;
create index if not exists idx_products_featured on products(is_featured);
create index if not exists idx_products_category on products(category_id);
create index if not exists idx_variants_product on product_variants(product_id);
create index if not exists idx_variants_sku on product_variants(sku);
create index if not exists idx_variants_active on product_variants(is_active) where deleted_at is null;

-- Triggers catálogo
drop trigger if exists trg_products_slug_norm on products;
create trigger trg_products_slug_norm before insert or update on products
for each row execute procedure normalize_slug();

drop trigger if exists trg_variants_sku_norm on product_variants;
create trigger trg_variants_sku_norm before insert or update on product_variants
for each row execute procedure normalize_sku();

drop trigger if exists trg_products_updated_at on products;
create trigger trg_products_updated_at before update on products
for each row execute procedure set_updated_at();

drop trigger if exists trg_variants_updated_at on product_variants;
create trigger trg_variants_updated_at before update on product_variants
for each row execute procedure set_updated_at();

drop trigger if exists trg_categories_updated_at on categories;
create trigger trg_categories_updated_at before update on categories
for each row execute procedure set_updated_at();

-- =========================
-- Órdenes / items
-- =========================
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  email text not null,
  status order_status not null default 'CREATED',
  subtotal_cents int not null,
  shipping_cents int not null default 0,
  discount_cents int not null default 0,
  total_cents int not null,
  currency text not null default 'COP' check (currency = 'COP'),
  shipping_address jsonb,
  billing_address jsonb,
  payment_provider text default 'MERCADO_PAGO',
  payment_status payment_status default 'PENDING',
  payment_preference_id text,
  payment_id text,
  payment_external_reference text,
  payment_raw jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  product_id uuid not null references products(id),
  variant_id uuid not null references product_variants(id),
  name_snapshot text not null,
  variant_label text,
  unit_price_cents int not null,
  quantity int not null check (quantity > 0)
);

create index if not exists idx_orders_email on orders(email);
create index if not exists idx_orders_created on orders(created_at);
create index if not exists idx_orders_status on orders(status);
create index if not exists idx_items_order on order_items(order_id);

-- =========================
-- Cupones / snapshots de cupones en orden
-- =========================
create table if not exists discount_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  type discount_type not null,
  value_percent int,
  value_cents int,
  currency text not null default 'COP' check (currency = 'COP'),
  min_order_cents int not null default 0,
  max_redemptions_total int,
  max_redemptions_per_customer int,
  combinable boolean not null default false,
  start_at timestamptz,
  end_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_discount_codes_upper on discount_codes;
create trigger trg_discount_codes_upper
before insert or update on discount_codes
for each row execute procedure uppercase_code();

drop trigger if exists trg_discount_codes_upd on discount_codes;
create trigger trg_discount_codes_upd before update on discount_codes
for each row execute procedure set_updated_at();

create table if not exists order_discounts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  discount_id uuid not null references discount_codes(id),
  code_snapshot text not null,
  type_snapshot discount_type not null,
  value_percent_snapshot int,
  value_cents_snapshot int,
  amount_applied_cents int not null default 0,
  currency text not null default 'COP' check (currency = 'COP'),
  created_at timestamptz not null default now()
);

create index if not exists idx_discount_codes_active on discount_codes(is_active);
create index if not exists idx_discount_codes_code on discount_codes(code);
create index if not exists idx_order_discounts_order on order_discounts(order_id);

-- =========================
-- RPC: decremento seguro de inventario
-- =========================
create or replace function decrement_inventory_safe(p_variant_id uuid, p_qty int)
returns void language plpgsql as $$
begin
  update product_variants
     set in_stock = in_stock - p_qty
   where id = p_variant_id
     and is_active = true
     and (deleted_at is null)
     and in_stock >= p_qty;
  if not found then
    raise exception 'Not enough stock or invalid variant %', p_variant_id;
  end if;
end $$;

-- =========================
-- Initial Categories Data
-- =========================
-- Insert basic categories for the existing product types
insert into categories (name) values 
  ('Creatinas'),
  ('Proteínas');

-- Update existing products to assign them to categories based on their type
-- This will run after products are created by seed data
-- Note: This assumes products will be created with the seed migration

commit;
