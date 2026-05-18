-- Inventory & Procurement (Kapelan CRM)
-- Created: 2026-04-23

-- Enable UUID generation
create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────────────────────────────────────
-- Suppliers (master)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  categories text[] not null default '{}'::text[],
  contact_email text,
  phone text,
  address text,
  terms jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Supplier catalog items (not physically on our warehouse by default)
create table if not exists public.supplier_items (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  name text not null,
  sku text,
  unit text not null,
  category text not null,
  buy_price numeric(12,2) not null default 0,
  sell_price numeric(12,2) not null default 0,
  availability text not null default 'order_only',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (supplier_id, sku)
);

create index if not exists supplier_items_supplier_id_idx on public.supplier_items (supplier_id);
create index if not exists supplier_items_category_idx on public.supplier_items (category);

-- ─────────────────────────────────────────────────────────────────────────────
-- Warehouse items (our internal SKU / catalog for what we sell/stock)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.warehouse_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null,
  unit text not null,
  sku text,
  item_type text not null default 'consumable',
  min_stock numeric(12,3) not null default 0,
  sell_price numeric(12,2) not null default 0,
  notes text,
  image_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sku)
);

create index if not exists warehouse_items_category_idx on public.warehouse_items (category);
create index if not exists warehouse_items_item_type_idx on public.warehouse_items (item_type);

-- Stock (physical on-hand)
create table if not exists public.warehouse_stock (
  warehouse_item_id uuid primary key references public.warehouse_items(id) on delete cascade,
  on_hand_qty numeric(12,3) not null default 0,
  updated_at timestamptz not null default now()
);

-- Link supplier items to our internal warehouse item (optional)
create table if not exists public.catalog_links (
  id uuid primary key default gen_random_uuid(),
  warehouse_item_id uuid references public.warehouse_items(id) on delete cascade,
  supplier_item_id uuid not null references public.supplier_items(id) on delete cascade,
  is_primary boolean not null default false,
  priority int not null default 100,
  created_at timestamptz not null default now(),
  unique (supplier_item_id),
  unique (warehouse_item_id, supplier_item_id)
);

create index if not exists catalog_links_wh_item_idx on public.catalog_links (warehouse_item_id);
create index if not exists catalog_links_supplier_item_idx on public.catalog_links (supplier_item_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Inventory movements (audit log)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  warehouse_item_id uuid not null references public.warehouse_items(id) on delete restrict,
  direction text not null check (direction in ('in','out','adjust')),
  qty numeric(12,3) not null,
  reason text not null,
  reference_type text,
  reference_id uuid,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists inventory_movements_item_idx on public.inventory_movements (warehouse_item_id);
create index if not exists inventory_movements_created_at_idx on public.inventory_movements (created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- Purchase requests (need-to-buy queue) and purchase orders (supplier orders)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.purchase_requests (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'pending',
  reason text not null default 'manual',
  order_id uuid,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.purchase_request_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_request_id uuid not null references public.purchase_requests(id) on delete cascade,
  warehouse_item_id uuid references public.warehouse_items(id) on delete set null,
  supplier_item_id uuid references public.supplier_items(id) on delete set null,
  qty numeric(12,3) not null,
  unit text,
  buy_price numeric(12,2),
  sell_price numeric(12,2),
  created_at timestamptz not null default now()
);

create index if not exists pr_lines_request_idx on public.purchase_request_lines (purchase_request_id);

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  status text not null default 'draft',
  total_cost numeric(12,2) not null default 0,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  supplier_item_id uuid references public.supplier_items(id) on delete set null,
  warehouse_item_id uuid references public.warehouse_items(id) on delete set null,
  name text not null,
  sku text,
  unit text not null,
  qty_ordered numeric(12,3) not null,
  qty_received numeric(12,3) not null default 0,
  buy_price numeric(12,2) not null default 0,
  total_cost numeric(12,2) not null default 0,
  category text,
  created_at timestamptz not null default now()
);

create index if not exists po_lines_po_idx on public.purchase_order_lines (purchase_order_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- updated_at triggers
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_suppliers_updated_at') then
    create trigger trg_suppliers_updated_at before update on public.suppliers
    for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_supplier_items_updated_at') then
    create trigger trg_supplier_items_updated_at before update on public.supplier_items
    for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_warehouse_items_updated_at') then
    create trigger trg_warehouse_items_updated_at before update on public.warehouse_items
    for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_purchase_requests_updated_at') then
    create trigger trg_purchase_requests_updated_at before update on public.purchase_requests
    for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_purchase_orders_updated_at') then
    create trigger trg_purchase_orders_updated_at before update on public.purchase_orders
    for each row execute function public.set_updated_at();
  end if;
end $$;

