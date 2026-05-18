-- Window operations, reservations, AI measurements and order economics
-- Created: 2026-05-18

create extension if not exists pgcrypto;

-- AI jobs for photo/sketch recognition during measurement.
create table if not exists public.measurement_ai_jobs (
  id uuid primary key default gen_random_uuid(),
  order_id text not null,
  source_kind text not null default 'measurement_photo',
  source_url text,
  prompt_version text not null default 'window_construct_v1',
  status text not null default 'pending'
    check (status in ('pending','running','done','needs_review','error')),
  raw_response jsonb,
  parsed_constructs jsonb not null default '[]'::jsonb,
  confidence numeric(5,2),
  error text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists measurement_ai_jobs_order_idx
  on public.measurement_ai_jobs (order_id, created_at desc);

-- Material requirements calculated from approved offer/BOM.
create table if not exists public.order_material_requirements (
  id uuid primary key default gen_random_uuid(),
  order_id text not null,
  window_construct_id text,
  offer_line_id text,
  warehouse_item_id uuid references public.warehouse_items(id) on delete set null,
  supplier_item_id uuid references public.supplier_items(id) on delete set null,
  name text not null,
  category text,
  unit text not null,
  required_qty numeric(12,3) not null default 0,
  reserved_qty numeric(12,3) not null default 0,
  purchased_qty numeric(12,3) not null default 0,
  consumed_qty numeric(12,3) not null default 0,
  source text not null default 'mixed'
    check (source in ('warehouse','supplier','mixed','manual')),
  planned_buy_price numeric(12,2) not null default 0,
  planned_sell_price numeric(12,2) not null default 0,
  actual_buy_price numeric(12,2),
  status text not null default 'draft'
    check (status in ('draft','reserved','need_purchase','ordered','received','issued','consumed','cancelled')),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists order_material_requirements_order_idx
  on public.order_material_requirements (order_id);
create index if not exists order_material_requirements_wh_idx
  on public.order_material_requirements (warehouse_item_id);
create index if not exists order_material_requirements_status_idx
  on public.order_material_requirements (status);

-- Explicit reservations. Physical stock is moved through inventory_movements.
create table if not exists public.warehouse_reservations (
  id uuid primary key default gen_random_uuid(),
  order_id text not null,
  requirement_id uuid references public.order_material_requirements(id) on delete cascade,
  warehouse_item_id uuid not null references public.warehouse_items(id) on delete restrict,
  qty numeric(12,3) not null,
  status text not null default 'active'
    check (status in ('active','released','consumed','cancelled')),
  created_at timestamptz not null default now(),
  released_at timestamptz
);

create index if not exists warehouse_reservations_order_idx
  on public.warehouse_reservations (order_id);
create index if not exists warehouse_reservations_item_idx
  on public.warehouse_reservations (warehouse_item_id, status);

-- Supplier request is a business-facing grouping before a real purchase order.
create table if not exists public.supplier_requests (
  id uuid primary key default gen_random_uuid(),
  order_id text,
  supplier_id uuid references public.suppliers(id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft','sent','confirmed','partially_received','received','cancelled')),
  expected_at date,
  total_cost numeric(12,2) not null default 0,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.supplier_request_lines (
  id uuid primary key default gen_random_uuid(),
  supplier_request_id uuid not null references public.supplier_requests(id) on delete cascade,
  requirement_id uuid references public.order_material_requirements(id) on delete set null,
  warehouse_item_id uuid references public.warehouse_items(id) on delete set null,
  supplier_item_id uuid references public.supplier_items(id) on delete set null,
  name text not null,
  unit text not null,
  qty numeric(12,3) not null,
  buy_price numeric(12,2) not null default 0,
  total_cost numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists supplier_request_lines_request_idx
  on public.supplier_request_lines (supplier_request_id);

-- Planned and actual order economics for owner/admin dashboards.
create table if not exists public.order_profit_snapshots (
  id uuid primary key default gen_random_uuid(),
  order_id text not null,
  snapshot_kind text not null default 'planned'
    check (snapshot_kind in ('planned','actual')),
  revenue numeric(12,2) not null default 0,
  material_cost numeric(12,2) not null default 0,
  labor_cost numeric(12,2) not null default 0,
  supplier_cost numeric(12,2) not null default 0,
  overhead_cost numeric(12,2) not null default 0,
  gross_profit numeric(12,2) not null default 0,
  gross_margin_pct numeric(6,2) not null default 0,
  source jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists order_profit_snapshots_order_idx
  on public.order_profit_snapshots (order_id, created_at desc);

-- Payment schedule from contract/payment graph documents.
create table if not exists public.order_payment_schedule (
  id uuid primary key default gen_random_uuid(),
  order_id text not null,
  title text not null,
  due_at date,
  amount numeric(12,2) not null default 0,
  status text not null default 'planned'
    check (status in ('planned','invoiced','paid','overdue','cancelled')),
  paid_at date,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists order_payment_schedule_order_idx
  on public.order_payment_schedule (order_id, due_at);

-- Production/assembly status for windows before installation.
create table if not exists public.window_production_items (
  id uuid primary key default gen_random_uuid(),
  order_id text not null,
  window_construct_id text,
  title text not null,
  status text not null default 'pending'
    check (status in ('pending','ordered','in_production','ready','delivered','installed','claim')),
  supplier_id uuid references public.suppliers(id) on delete set null,
  planned_ready_at date,
  actual_ready_at date,
  claim_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists window_production_items_order_idx
  on public.window_production_items (order_id, status);

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_measurement_ai_jobs_updated_at') then
    create trigger trg_measurement_ai_jobs_updated_at
    before update on public.measurement_ai_jobs
    for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_order_material_requirements_updated_at') then
    create trigger trg_order_material_requirements_updated_at
    before update on public.order_material_requirements
    for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_supplier_requests_updated_at') then
    create trigger trg_supplier_requests_updated_at
    before update on public.supplier_requests
    for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_order_payment_schedule_updated_at') then
    create trigger trg_order_payment_schedule_updated_at
    before update on public.order_payment_schedule
    for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_window_production_items_updated_at') then
    create trigger trg_window_production_items_updated_at
    before update on public.window_production_items
    for each row execute function public.set_updated_at();
  end if;
end $$;
