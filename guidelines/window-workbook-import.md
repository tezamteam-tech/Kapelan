# Window Workbook Import

The importer converts the uploaded supplier and operations workbooks into reviewable Supabase SQL.

## Inputs

- `69c38967982f6.xlsx`: Avansum profile/glass price matrices and component catalog.
- `Закупки ОС+.xlsx`: OS+ materials, balcony finishing consumables and labor rates.

## Output

- `supabase/seed/window_import_seed.sql`: idempotent SQL with suppliers, warehouse items, supplier items, catalog links, work rates, price matrices and matrix cells.
- `supabase/seed/window_import_preview.json`: counts and first parsed samples for quick review.

## Run

```bash
npm run import:windows
```

Optional explicit paths:

```bash
npm run import:windows -- \
  --avansum "C:/Users/dozor/Downloads/Telegram Desktop/69c38967982f6.xlsx" \
  --os-plus "C:/Users/dozor/Downloads/Telegram Desktop/Закупки ОС+.xlsx"
```

Apply `supabase/migrations/20260518152000_window_import_metadata.sql` before loading the generated seed. The extra columns let one supplier sheet store multiple construction variants instead of flattening them into a single ambiguous matrix.

If the local machine has no working `python` command, set `WINDOW_IMPORT_PYTHON` to a Python executable with `openpyxl` installed. In Codex Desktop the npm command automatically uses the bundled runtime.
