ALTER TABLE tenant_settings 
ADD COLUMN IF NOT EXISTS track_loads_in_income BOOLEAN DEFAULT false;

NOTIFY pgrst, 'reload schema';
