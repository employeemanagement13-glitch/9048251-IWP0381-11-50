-- ============================================================================
-- MDOS v50 — Outlets & Trade Reports Schema Upgrade
-- Adds status, tax_number, sub_trade_channel, trade_channel, gps, open_date, filer_status
-- ============================================================================

ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'Active';
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS tax_number TEXT;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS sub_trade_channel TEXT;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS trade_channel TEXT;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS gps TEXT;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS open_date TEXT;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS filer_status TEXT DEFAULT 'No';

-- Notify PostgREST to reload schema cache immediately
NOTIFY pgrst, 'reload schema';
