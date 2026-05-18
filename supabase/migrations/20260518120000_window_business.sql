-- Window business domain extension
-- Created: 2026-05-18

create extension if not exists pgcrypto;

-- Profile/glass price matrices imported from supplier workbooks such as Avansum.
create table if not exists public.window_price_matrices (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references public.suppliers(id) on delete set null,
  name text not null,
  profile_system text not null,
  glass_unit text not null,
  color text not null default 'Белый',
  effective_from date,
  source_file text,
  source_sheet text,
  rounding_policy text not null default 'ceil_to_matrix',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_system, glass_unit, color, source_sheet)
);

create index if not exists window_price_matrices_profile_idx
  on public.window_price_matrices (profile_system, glass_unit, color);

create table if not exists public.window_price_matrix_cells (
  id uuid primary key default gen_random_uuid(),
  matrix_id uuid not null references public.window_price_matrices(id) on delete cascade,
  width_mm int not null,
  height_mm int not null,
  price numeric(12,2) not null,
  created_at timestamptz not null default now(),
  unique (matrix_id, width_mm, height_mm)
);

create index if not exists window_price_matrix_cells_lookup_idx
  on public.window_price_matrix_cells (matrix_id, width_mm, height_mm);

-- Order-level measured constructions. This table mirrors the KV field used by the current MVP.
create table if not exists public.window_constructs (
  id uuid primary key default gen_random_uuid(),
  order_id text not null,
  title text not null,
  room_name text,
  location_label text,
  construction_type text not null default 'window',
  width_mm int not null,
  height_mm int not null,
  quantity numeric(12,3) not null default 1,
  profile_system text,
  glass_unit text,
  hardware_type text,
  color_inside text,
  color_outside text,
  lamination text not null default 'none',
  options jsonb not null default '{}'::jsonb,
  opening_scheme jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists window_constructs_order_idx
  on public.window_constructs (order_id);

create index if not exists window_constructs_type_idx
  on public.window_constructs (construction_type);

-- Work rates from "Закупки ОС+.xlsx" / "оплата труда".
create table if not exists public.window_work_rates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  unit text not null,
  rate numeric(12,2) not null default 0,
  source_file text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name, category, unit)
);

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_window_price_matrices_updated_at') then
    create trigger trg_window_price_matrices_updated_at
    before update on public.window_price_matrices
    for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_window_constructs_updated_at') then
    create trigger trg_window_constructs_updated_at
    before update on public.window_constructs
    for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_window_work_rates_updated_at') then
    create trigger trg_window_work_rates_updated_at
    before update on public.window_work_rates
    for each row execute function public.set_updated_at();
  end if;
end $$;
