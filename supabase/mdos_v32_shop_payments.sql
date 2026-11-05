-- Migration v32: shop_payments table & updated bank_account_ledger view

CREATE TABLE IF NOT EXISTS shop_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
  bank_account_id UUID REFERENCES bank_accounts(id) ON DELETE SET NULL,
  amount NUMERIC(14,2) NOT NULL,
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE shop_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shop_payments_tenant ON shop_payments;
CREATE POLICY shop_payments_tenant ON shop_payments FOR ALL
  USING (tenant_id = (SELECT current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT current_tenant_id()));

CREATE INDEX IF NOT EXISTS idx_shop_payments_shop    ON shop_payments(shop_id);
CREATE INDEX IF NOT EXISTS idx_shop_payments_invoice ON shop_payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_shop_payments_bank    ON shop_payments(bank_account_id);
CREATE INDEX IF NOT EXISTS idx_shop_payments_tenant  ON shop_payments(tenant_id);


CREATE OR REPLACE VIEW bank_account_ledger WITH (security_invoker = TRUE) AS
SELECT
  cd.tenant_id,
  cd.bank_account_id,
  cd.deposit_date                                  AS txn_date,
  'Deposit'::TEXT                                  AS txn_type,
  COALESCE(cd.bank_ref_no, 'Cash Deposit')         AS reference,
  cd.amount                                        AS amount_in,
  0::NUMERIC(14,2)                                 AS amount_out,
  NULL::TEXT                                       AS po_no
FROM cash_deposits cd
WHERE cd.status = 'deposited' AND cd.bank_account_id IS NOT NULL

UNION ALL

SELECT
  sp.tenant_id,
  sp.bank_account_id,
  sp.payment_date                                  AS txn_date,
  'Credit Sale'::TEXT                              AS txn_type,
  COALESCE(inv.invoice_no, 'Credit Payment')       AS reference,
  sp.amount                                        AS amount_in,
  0::NUMERIC(14,2)                                 AS amount_out,
  NULL::TEXT                                       AS po_no
FROM shop_payments sp
LEFT JOIN invoices inv ON sp.invoice_id = inv.id
WHERE sp.bank_account_id IS NOT NULL

UNION ALL

SELECT
  sio.tenant_id,
  sio.paid_from_bank_account_id                    AS bank_account_id,
  COALESCE(sio.billed_date, sio.transaction_date)  AS txn_date,
  'Sell In Payment'::TEXT                          AS txn_type,
  sio.po_no                                        AS reference,
  0::NUMERIC(14,2)                                 AS amount_in,
  COALESCE((
    SELECT SUM(CASE WHEN invoice_type='purchase' THEN net_bill_amount ELSE -net_bill_amount END)
    FROM sell_in_lines WHERE sell_in_order_id = sio.id
  ), 0)                                            AS amount_out,
  sio.po_no
FROM sell_in_orders sio
WHERE sio.status = 'billed' AND sio.paid_from_bank_account_id IS NOT NULL;
