-- Migration v33: Vendor Accounts + On-Credit PO tracking

CREATE TABLE IF NOT EXISTS vendor_accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  vendor_name     TEXT NOT NULL,
  account_title   TEXT NOT NULL,
  account_number  TEXT,
  current_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vendor_accounts_tenant ON vendor_accounts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_vendor_accounts_active ON vendor_accounts(tenant_id, active);

ALTER TABLE vendor_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vendor_accounts_tenant ON vendor_accounts;
CREATE POLICY vendor_accounts_tenant ON vendor_accounts FOR ALL
  USING (tenant_id = (SELECT current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT current_tenant_id()));

ALTER TABLE sell_in_orders
  ADD COLUMN IF NOT EXISTS payment_voucher   TEXT,
  ADD COLUMN IF NOT EXISTS paid_amount       NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vendor_account_id UUID REFERENCES vendor_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sell_in_orders_vendor ON sell_in_orders(vendor_account_id)
  WHERE vendor_account_id IS NOT NULL;

DROP VIEW IF EXISTS vendor_account_ledger;

CREATE VIEW vendor_account_ledger WITH (security_invoker = TRUE) AS

SELECT
  sio.tenant_id,
  sio.vendor_account_id,
  sio.transaction_date                                                AS txn_date,
  ('Sell In-OnCredit-PO-' || sio.po_no)::TEXT                        AS txn_type,
  COALESCE(sio.payment_voucher, '—')                                  AS reference,
  COALESCE((
    SELECT SUM(CASE WHEN sil.invoice_type = 'purchase'
                    THEN COALESCE(sil.bill_amount, sil.net_bill_amount, sil.rate * sil.qty)
                    ELSE -COALESCE(sil.bill_amount, sil.net_bill_amount, sil.rate * sil.qty)
               END)
    FROM sell_in_lines sil
    WHERE sil.sell_in_order_id = sio.id
  ), 0)::NUMERIC(14,2)                                                AS amount_in,
  0::NUMERIC(14,2)                                                    AS amount_out,
  sio.po_no
FROM sell_in_orders sio
WHERE sio.status IN ('on_credit', 'billed')
  AND sio.vendor_account_id IS NOT NULL

UNION ALL

SELECT
  sio.tenant_id,
  sio.vendor_account_id,
  COALESCE(sio.billed_date, sio.created_at::DATE, CURRENT_DATE)      AS txn_date,
  ('Sell In-Billed-PO-' || sio.po_no)::TEXT                          AS txn_type,
  COALESCE(sio.payment_voucher, '—')                                  AS reference,
  0::NUMERIC(14,2)                                                    AS amount_in,
  COALESCE(sio.paid_amount, 0)::NUMERIC(14,2)                        AS amount_out,
  sio.po_no
FROM sell_in_orders sio
WHERE COALESCE(sio.paid_amount, 0) > 0
  AND sio.vendor_account_id IS NOT NULL;



