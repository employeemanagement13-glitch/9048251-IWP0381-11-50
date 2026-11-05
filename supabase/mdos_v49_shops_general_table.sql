-- ============================================================================
-- MDOS v49 — General Shops Table Schema Upgrade
-- Adds address, main_channel_desc, preseller_name, segment_desc to shops table.
-- ============================================================================

ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS main_channel_desc TEXT;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS preseller_name TEXT;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS segment_desc TEXT;

-- Notify PostgREST to reload schema cache immediately
NOTIFY pgrst, 'reload schema';
