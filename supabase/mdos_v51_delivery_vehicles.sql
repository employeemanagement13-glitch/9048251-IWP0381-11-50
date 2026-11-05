ALTER TABLE public.dm_routes ALTER COLUMN dm_id DROP NOT NULL;
ALTER TABLE public.dm_routes ALTER COLUMN route_name DROP NOT NULL;

ALTER TABLE public.dm_routes ADD COLUMN IF NOT EXISTS code TEXT;
ALTER TABLE public.dm_routes ADD COLUMN IF NOT EXISTS dm_name TEXT;
ALTER TABLE public.dm_routes ADD COLUMN IF NOT EXISTS personnel TEXT;
ALTER TABLE public.dm_routes ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE public.dm_routes ADD COLUMN IF NOT EXISTS vehicle_type TEXT;
ALTER TABLE public.dm_routes ADD COLUMN IF NOT EXISTS model TEXT;
ALTER TABLE public.dm_routes ADD COLUMN IF NOT EXISTS brand TEXT;
ALTER TABLE public.dm_routes ADD COLUMN IF NOT EXISTS year TEXT;
ALTER TABLE public.dm_routes ADD COLUMN IF NOT EXISTS cap_weight TEXT;
ALTER TABLE public.dm_routes ADD COLUMN IF NOT EXISTS cap_volume TEXT;

NOTIFY pgrst, 'reload schema';
