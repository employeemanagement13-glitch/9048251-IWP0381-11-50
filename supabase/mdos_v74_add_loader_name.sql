-- ============================================================================
-- mdos_v74_add_loader_name.sql
--
-- Adds loader_name column to loaders table to allow free-text loader names
-- without requiring an employee directory match.
-- ============================================================================

ALTER TABLE public.loaders ADD COLUMN IF NOT EXISTS loader_name TEXT;

-- Backfill loader_name from linked employees for existing records if null
UPDATE public.loaders l
SET loader_name = e.full_name
FROM public.employees e
WHERE l.loader_id = e.id AND l.loader_name IS NULL;

NOTIFY pgrst, 'reload schema';
