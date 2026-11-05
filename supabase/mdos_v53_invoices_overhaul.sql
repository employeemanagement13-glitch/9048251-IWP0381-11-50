-- ============================================================================
-- MDOS v53: Invoices Table Overhaul & Stock Trigger Disconnection
-- ============================================================================

-- 1. Add new columns to invoices table
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS outlet_code text,
  ADD COLUMN IF NOT EXISTS outlet_name text,
  ADD COLUMN IF NOT EXISTS record_date date,
  ADD COLUMN IF NOT EXISTS delivery_date date,
  ADD COLUMN IF NOT EXISTS seller_code text,
  ADD COLUMN IF NOT EXISTS seller_name text,
  ADD COLUMN IF NOT EXISTS store_name text,
  ADD COLUMN IF NOT EXISTS outlet_type text,
  ADD COLUMN IF NOT EXISTS total_qty numeric(12,2),
  ADD COLUMN IF NOT EXISTS amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS tax_return text,
  ADD COLUMN IF NOT EXISTS excl_tax numeric(14,2),
  ADD COLUMN IF NOT EXISTS sales_tax numeric(14,2),
  ADD COLUMN IF NOT EXISTS adv_tax numeric(14,2),
  ADD COLUMN IF NOT EXISTS disc_tot numeric(14,2);

-- 2. Make legacy columns nullable so standalone imports without them succeed
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'invoices' AND column_name = 'products') THEN
    ALTER TABLE invoices ALTER COLUMN products DROP NOT NULL;
    ALTER TABLE invoices ALTER COLUMN products SET DEFAULT '';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'invoices' AND column_name = 'invoice_date') THEN
    ALTER TABLE invoices ALTER COLUMN invoice_date DROP NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'invoices' AND column_name = 'scheduled_date') THEN
    ALTER TABLE invoices ALTER COLUMN scheduled_date DROP NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'invoices' AND column_name = 'promo_type') THEN
    ALTER TABLE invoices ALTER COLUMN promo_type DROP NOT NULL;
    ALTER TABLE invoices ALTER COLUMN promo_type SET DEFAULT 'none';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'invoices' AND column_name = 'shop_id') THEN
    ALTER TABLE invoices ALTER COLUMN shop_id DROP NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'invoices' AND column_name = 'invoice_type') THEN
    ALTER TABLE invoices ALTER COLUMN invoice_type DROP NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'invoices' AND column_name = 'invoice_total') THEN
    ALTER TABLE invoices ALTER COLUMN invoice_total DROP NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'invoices' AND column_name = 'delivery_status') THEN
    ALTER TABLE invoices ALTER COLUMN delivery_status DROP NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'invoices' AND column_name = 'visit_status') THEN
    ALTER TABLE invoices ALTER COLUMN visit_status DROP NOT NULL;
  END IF;
END $$;

-- 3. Create helpful indexes for performance
CREATE INDEX IF NOT EXISTS idx_invoices_outlet_code ON invoices(outlet_code);
CREATE INDEX IF NOT EXISTS idx_invoices_record_date ON invoices(record_date);

-- 4. Disconnect product tracking / triggers from inventory/stock reports
DROP TRIGGER IF EXISTS trg_sync_invoice_line_items ON invoices;
DROP TRIGGER IF EXISTS trg_move_stock_on_delivery ON invoices;
DROP TRIGGER IF EXISTS trg_auto_create_cash_deposit ON invoices;
DROP TRIGGER IF EXISTS trg_reserve_stock_on_invoice ON invoices;
DROP TRIGGER IF EXISTS trg_update_reserved_on_invoice_edit ON invoices;
DROP TRIGGER IF EXISTS trg_release_stock_on_invoice_delete ON invoices;

-- 5. Recreate advance_tax_report view with new columns
DROP VIEW IF EXISTS advance_tax_report CASCADE;
CREATE OR REPLACE VIEW advance_tax_report WITH (security_invoker = TRUE) AS
SELECT
  tenant_id,
  COALESCE(record_date, invoice_date) AS date,
  SUM(COALESCE(amount, grand_total, 0)) AS sale,
  0 AS cash_collection,
  SUM(COALESCE(adv_tax, advance_tax, 0)) AS tax_collected
FROM invoices
GROUP BY tenant_id, COALESCE(record_date, invoice_date);

-- 6. Reload schema cache
NOTIFY pgrst, 'reload schema';
