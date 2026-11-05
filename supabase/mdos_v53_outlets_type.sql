-- ============================================================================
-- MDOS v53 — Outlets Type Schema Upgrade
-- Adds outlet_type to shops table
-- ============================================================================

ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS outlet_type TEXT;

-- Notify PostgREST to reload schema cache immediately
NOTIFY pgrst, 'reload schema';
