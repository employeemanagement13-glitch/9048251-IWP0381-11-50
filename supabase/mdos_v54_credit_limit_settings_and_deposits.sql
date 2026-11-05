-- ============================================================================
-- MDOS v54: Credit Invoices Limit, Cash Deposits Description & Credit Type Sync
-- ============================================================================

-- 1. Add credit_invoices_limit to tenant_settings
ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS credit_invoices_limit integer NOT NULL DEFAULT 1;

-- 2. Add description to cash_deposits
ALTER TABLE cash_deposits
  ADD COLUMN IF NOT EXISTS description text;

-- 3. Backfill/sync invoice_type = 'credit' for invoices linked to credit shops
UPDATE invoices i
SET invoice_type = 'credit'
FROM shops s
WHERE i.shop_id = s.id
  AND (s.shop_type = 'credit' OR LOWER(COALESCE(s.outlet_type, '')) = 'credit')
  AND (i.invoice_type IS NULL OR i.invoice_type != 'credit');

-- 4. Also update any invoice where outlet_type indicates credit
UPDATE invoices
SET invoice_type = 'credit'
WHERE LOWER(COALESCE(outlet_type, '')) = 'credit'
  AND (invoice_type IS NULL OR invoice_type != 'credit');

-- 5. Reload schema cache
NOTIFY pgrst, 'reload schema';
