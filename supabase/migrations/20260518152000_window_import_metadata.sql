-- Window workbook import metadata
-- Created: 2026-05-18

alter table if exists public.window_price_matrices
  add column if not exists matrix_kind text not null default 'window',
  add column if not exists hardware_type text not null default 'standard',
  add column if not exists variant_label text not null default 'standard',
  add column if not exists source_block int not null default 1,
  add column if not exists meta jsonb not null default '{}'::jsonb;

alter table if exists public.window_price_matrices
  alter column color set default 'Белый';

alter table if exists public.window_price_matrices
  drop constraint if exists window_price_matrices_profile_system_glass_unit_color_source_sheet_key;

create unique index if not exists window_price_matrices_import_key_idx
  on public.window_price_matrices (
    profile_system,
    glass_unit,
    color,
    source_sheet,
    source_block
  );

create index if not exists window_price_matrices_kind_idx
  on public.window_price_matrices (matrix_kind, hardware_type);
