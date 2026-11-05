ALTER TABLE discount_config_products ADD COLUMN IF NOT EXISTS qty numeric(12,2) NOT NULL DEFAULT 0;
NOTIFY pgrst, 'reload schema';
