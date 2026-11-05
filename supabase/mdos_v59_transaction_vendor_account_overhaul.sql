-- Migration v59: Transaction/Vendor Account overhaul
-- 1. Add description column to bank_accounts (Transaction Accounts)
-- 2. Create cash_movements table
-- 3. Add vendor_account_id to scheme_income
-- 4. Add vendor_account_id to expense_penalties
-- 5. Update bank_account_ledger view (add Movement IN, keep Deposit using description as reference)
-- 6. Update vendor_account_ledger view (add Penalty, Scheme, Movement)

ALTER TABLE bank_accounts
  ADD COLUMN IF NOT EXISTS description TEXT,
  ALTER COLUMN bank_name DROP NOT NULL;

CREATE TABLE IF NOT EXISTS cash_movements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL DEFAULT current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
  movement_date   DATE NOT NULL,
  description     TEXT,
  from_account_id UUID,
  from_account_type TEXT CHECK (from_account_type IN ('transaction', 'vendor')),
  to_account_id   UUID,
  to_account_type TEXT CHECK (to_account_type IN ('transaction', 'vendor')),
  amount          NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE cash_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation_cash_movements" ON cash_movements;
CREATE POLICY "tenant_isolation_cash_movements"
  ON cash_movements
  USING  (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE scheme_income
  ADD COLUMN IF NOT EXISTS vendor_account_id UUID REFERENCES vendor_accounts(id) ON DELETE SET NULL;

ALTER TABLE expense_penalties
  ADD COLUMN IF NOT EXISTS vendor_account_id UUID REFERENCES vendor_accounts(id) ON DELETE SET NULL;

NOTIFY pgrst, 'reload schema';

DROP VIEW IF EXISTS bank_account_ledger CASCADE;

CREATE VIEW bank_account_ledger WITH (security_invoker = TRUE) AS

SELECT
  cd.tenant_id,
  cd.bank_account_id,
  cd.deposit_date                                  AS txn_date,
  'Deposit'::TEXT                                  AS txn_type,
  COALESCE(cd.description, cd.bank_ref_no, 'Cash Deposit') AS reference,
  cd.amount::NUMERIC(14,2)                         AS amount_in,
  0::NUMERIC(14,2)                                 AS amount_out,
  NULL::TEXT                                       AS po_no
FROM cash_deposits cd
WHERE cd.bank_account_id IS NOT NULL

UNION ALL

SELECT
  sp.tenant_id,
  sp.bank_account_id,
  sp.payment_date                                  AS txn_date,
  'Credit Sale'::TEXT                              AS txn_type,
  COALESCE(inv.invoice_no, 'Credit Payment')       AS reference,
  sp.amount::NUMERIC(14,2)                         AS amount_in,
  0::NUMERIC(14,2)                                 AS amount_out,
  NULL::TEXT                                       AS po_no
FROM shop_payments sp
LEFT JOIN invoices inv ON sp.invoice_id = inv.id
WHERE sp.bank_account_id IS NOT NULL

UNION ALL

SELECT
  pr.tenant_id,
  pr.bank_account_id,
  COALESCE(pr.expense_date, pr.salary_month::DATE)  AS txn_date,
  'Expense'::TEXT                                   AS txn_type,
  COALESCE(e.employee_code, '') || ' | ' || COALESCE(e.full_name, '') || ' | Salary' AS reference,
  0::NUMERIC(14,2)                                  AS amount_in,
  COALESCE(pr.net_payable, 0)::NUMERIC(14,2)        AS amount_out,
  NULL::TEXT                                        AS po_no
FROM payroll_runs pr
LEFT JOIN employees e ON pr.employee_id = e.id
WHERE pr.bank_account_id IS NOT NULL

UNION ALL

SELECT
  fe.tenant_id,
  fe.bank_account_id,
  fe.entry_date                                     AS txn_date,
  'Expense'::TEXT                                   AS txn_type,
  COALESCE(fe.truck_no, '') || ' | ' || COALESCE(fe.driver_name, '') || ' | Fuel' AS reference,
  0::NUMERIC(14,2)                                  AS amount_in,
  COALESCE(fe.amount, 0)::NUMERIC(14,2)             AS amount_out,
  NULL::TEXT                                        AS po_no
FROM fuel_entries fe
WHERE fe.bank_account_id IS NOT NULL

UNION ALL

SELECT
  eb.tenant_id,
  eb.bank_account_id,
  COALESCE(eb.expense_date, (eb.year || '-' || CASE
    WHEN LOWER(eb.month) IN ('january','jan') THEN '01'
    WHEN LOWER(eb.month) IN ('february','feb') THEN '02'
    WHEN LOWER(eb.month) IN ('march','mar') THEN '03'
    WHEN LOWER(eb.month) IN ('april','apr') THEN '04'
    WHEN LOWER(eb.month) IN ('may') THEN '05'
    WHEN LOWER(eb.month) IN ('june','jun') THEN '06'
    WHEN LOWER(eb.month) IN ('july','jul') THEN '07'
    WHEN LOWER(eb.month) IN ('august','aug') THEN '08'
    WHEN LOWER(eb.month) IN ('september','sep') THEN '09'
    WHEN LOWER(eb.month) IN ('october','oct') THEN '10'
    WHEN LOWER(eb.month) IN ('november','nov') THEN '11'
    WHEN LOWER(eb.month) IN ('december','dec') THEN '12'
    ELSE '01'
  END || '-01')::DATE)                               AS txn_date,
  'Expense'::TEXT                                   AS txn_type,
  COALESCE(eb.bill_name, '') || ' | Bill'           AS reference,
  0::NUMERIC(14,2)                                  AS amount_in,
  COALESCE(eb.amount, 0)::NUMERIC(14,2)             AS amount_out,
  NULL::TEXT                                        AS po_no
FROM expense_bills eb
WHERE eb.bank_account_id IS NOT NULL

UNION ALL

SELECT
  ee.tenant_id,
  ee.bank_account_id,
  COALESCE(ee.expense_date, (ee.year || '-' || CASE
    WHEN LOWER(ee.month) IN ('january','jan') THEN '01'
    WHEN LOWER(ee.month) IN ('february','feb') THEN '02'
    WHEN LOWER(ee.month) IN ('march','mar') THEN '03'
    WHEN LOWER(ee.month) IN ('april','apr') THEN '04'
    WHEN LOWER(ee.month) IN ('may') THEN '05'
    WHEN LOWER(ee.month) IN ('june','jun') THEN '06'
    WHEN LOWER(ee.month) IN ('july','jul') THEN '07'
    WHEN LOWER(ee.month) IN ('august','aug') THEN '08'
    WHEN LOWER(ee.month) IN ('september','sep') THEN '09'
    WHEN LOWER(ee.month) IN ('october','oct') THEN '10'
    WHEN LOWER(ee.month) IN ('november','nov') THEN '11'
    WHEN LOWER(ee.month) IN ('december','dec') THEN '12'
    ELSE '01'
  END || '-01')::DATE)                               AS txn_date,
  'Expense'::TEXT                                   AS txn_type,
  COALESCE(ee.description, '') || ' | Entertainment' AS reference,
  0::NUMERIC(14,2)                                  AS amount_in,
  COALESCE(ee.amount, 0)::NUMERIC(14,2)             AS amount_out,
  NULL::TEXT                                        AS po_no
FROM expense_entertainment ee
WHERE ee.bank_account_id IS NOT NULL

UNION ALL

SELECT
  ep.tenant_id,
  ep.bank_account_id,
  COALESCE(ep.expense_date, (ep.year || '-' || CASE
    WHEN LOWER(ep.month) IN ('january','jan') THEN '01'
    WHEN LOWER(ep.month) IN ('february','feb') THEN '02'
    WHEN LOWER(ep.month) IN ('march','mar') THEN '03'
    WHEN LOWER(ep.month) IN ('april','apr') THEN '04'
    WHEN LOWER(ep.month) IN ('may') THEN '05'
    WHEN LOWER(ep.month) IN ('june','jun') THEN '06'
    WHEN LOWER(ep.month) IN ('july','jul') THEN '07'
    WHEN LOWER(ep.month) IN ('august','aug') THEN '08'
    WHEN LOWER(ep.month) IN ('september','sep') THEN '09'
    WHEN LOWER(ep.month) IN ('october','oct') THEN '10'
    WHEN LOWER(ep.month) IN ('november','nov') THEN '11'
    WHEN LOWER(ep.month) IN ('december','dec') THEN '12'
    ELSE '01'
  END || '-01')::DATE)                               AS txn_date,
  'Expense'::TEXT                                   AS txn_type,
  COALESCE(ep.description, '') || ' | Petty'         AS reference,
  0::NUMERIC(14,2)                                  AS amount_in,
  COALESCE(ep.amount, 0)::NUMERIC(14,2)             AS amount_out,
  NULL::TEXT                                        AS po_no
FROM expense_petty ep
WHERE ep.bank_account_id IS NOT NULL

UNION ALL

SELECT
  cm.tenant_id,
  cm.from_account_id                               AS bank_account_id,
  cm.movement_date                                 AS txn_date,
  'Movement'::TEXT                                 AS txn_type,
  COALESCE(
    (SELECT account_title FROM bank_accounts WHERE id = cm.from_account_id),
    (SELECT account_title FROM vendor_accounts WHERE id = cm.from_account_id),
    '?'
  ) || ' → ' || COALESCE(
    (SELECT account_title FROM bank_accounts WHERE id = cm.to_account_id),
    (SELECT account_title FROM vendor_accounts WHERE id = cm.to_account_id),
    '?'
  )                                                AS reference,
  0::NUMERIC(14,2)                                 AS amount_in,
  cm.amount::NUMERIC(14,2)                         AS amount_out,
  NULL::TEXT                                       AS po_no
FROM cash_movements cm
WHERE cm.from_account_type = 'transaction' AND cm.from_account_id IS NOT NULL

UNION ALL

SELECT
  cm.tenant_id,
  cm.to_account_id                                 AS bank_account_id,
  cm.movement_date                                 AS txn_date,
  'Movement'::TEXT                                 AS txn_type,
  COALESCE(
    (SELECT account_title FROM bank_accounts WHERE id = cm.from_account_id),
    (SELECT account_title FROM vendor_accounts WHERE id = cm.from_account_id),
    '?'
  ) || ' → ' || COALESCE(
    (SELECT account_title FROM bank_accounts WHERE id = cm.to_account_id),
    (SELECT account_title FROM vendor_accounts WHERE id = cm.to_account_id),
    '?'
  )                                                AS reference,
  cm.amount::NUMERIC(14,2)                         AS amount_in,
  0::NUMERIC(14,2)                                 AS amount_out,
  NULL::TEXT                                       AS po_no
FROM cash_movements cm
WHERE cm.to_account_type = 'transaction' AND cm.to_account_id IS NOT NULL;

DROP VIEW IF EXISTS vendor_account_ledger CASCADE;

CREATE VIEW vendor_account_ledger WITH (security_invoker = TRUE) AS

SELECT
  sio.tenant_id,
  sio.vendor_account_id,
  sio.transaction_date                                                AS txn_date,
  'Sell In'::TEXT                                                     AS txn_type,
  'Invoice No (' || COALESCE(sio.company_inv_no, '—') || ') | PO No (' || COALESCE(sio.po_no, '—') || ')' AS reference,
  0::NUMERIC(14,2)                                                    AS amount_in,
  COALESCE((
    SELECT SUM(CASE WHEN sil.invoice_type = 'purchase'
                    THEN COALESCE(sil.bill_amount, sil.net_bill_amount, sil.rate * sil.qty)
                    ELSE -COALESCE(sil.bill_amount, sil.net_bill_amount, sil.rate * sil.qty)
               END)
    FROM sell_in_lines sil
    WHERE sil.sell_in_order_id = sio.id
  ), 0)::NUMERIC(14,2)                                                AS amount_out,
  sio.po_no
FROM sell_in_orders sio
WHERE sio.vendor_account_id IS NOT NULL

UNION ALL

SELECT
  epn.tenant_id,
  epn.vendor_account_id,
  COALESCE(epn.expense_date, (epn.year || '-' || CASE
    WHEN LOWER(epn.month) IN ('january','jan') THEN '01'
    WHEN LOWER(epn.month) IN ('february','feb') THEN '02'
    WHEN LOWER(epn.month) IN ('march','mar') THEN '03'
    WHEN LOWER(epn.month) IN ('april','apr') THEN '04'
    WHEN LOWER(epn.month) IN ('may') THEN '05'
    WHEN LOWER(epn.month) IN ('june','jun') THEN '06'
    WHEN LOWER(epn.month) IN ('july','jul') THEN '07'
    WHEN LOWER(epn.month) IN ('august','aug') THEN '08'
    WHEN LOWER(epn.month) IN ('september','sep') THEN '09'
    WHEN LOWER(epn.month) IN ('october','oct') THEN '10'
    WHEN LOWER(epn.month) IN ('november','nov') THEN '11'
    WHEN LOWER(epn.month) IN ('december','dec') THEN '12'
    ELSE '01'
  END || '-01')::DATE)                               AS txn_date,
  'Penalty'::TEXT                                   AS txn_type,
  COALESCE(epn.description, '')                     AS reference,
  0::NUMERIC(14,2)                                  AS amount_in,
  COALESCE(epn.amount, 0)::NUMERIC(14,2)            AS amount_out,
  NULL::TEXT                                        AS po_no
FROM expense_penalties epn
WHERE epn.vendor_account_id IS NOT NULL

UNION ALL

SELECT
  si.tenant_id,
  si.vendor_account_id,
  COALESCE(si.income_date, si.income_month::DATE)   AS txn_date,
  'Scheme'::TEXT                                    AS txn_type,
  COALESCE(si.description, 'Scheme Income')         AS reference,
  COALESCE(si.amount, 0)::NUMERIC(14,2)             AS amount_in,
  0::NUMERIC(14,2)                                  AS amount_out,
  NULL::TEXT                                        AS po_no
FROM scheme_income si
WHERE si.vendor_account_id IS NOT NULL

UNION ALL

SELECT
  cm.tenant_id,
  cm.from_account_id                               AS vendor_account_id,
  cm.movement_date                                 AS txn_date,
  'Movement'::TEXT                                 AS txn_type,
  COALESCE(
    (SELECT account_title FROM bank_accounts WHERE id = cm.from_account_id),
    (SELECT account_title FROM vendor_accounts WHERE id = cm.from_account_id),
    '?'
  ) || ' → ' || COALESCE(
    (SELECT account_title FROM bank_accounts WHERE id = cm.to_account_id),
    (SELECT account_title FROM vendor_accounts WHERE id = cm.to_account_id),
    '?'
  )                                                AS reference,
  0::NUMERIC(14,2)                                 AS amount_in,
  cm.amount::NUMERIC(14,2)                         AS amount_out,
  NULL::TEXT                                       AS po_no
FROM cash_movements cm
WHERE cm.from_account_type = 'vendor' AND cm.from_account_id IS NOT NULL

UNION ALL

SELECT
  cm.tenant_id,
  cm.to_account_id                                 AS vendor_account_id,
  cm.movement_date                                 AS txn_date,
  'Movement'::TEXT                                 AS txn_type,
  COALESCE(
    (SELECT account_title FROM bank_accounts WHERE id = cm.from_account_id),
    (SELECT account_title FROM vendor_accounts WHERE id = cm.from_account_id),
    '?'
  ) || ' → ' || COALESCE(
    (SELECT account_title FROM bank_accounts WHERE id = cm.to_account_id),
    (SELECT account_title FROM vendor_accounts WHERE id = cm.to_account_id),
    '?'
  )                                                AS reference,
  cm.amount::NUMERIC(14,2)                         AS amount_in,
  0::NUMERIC(14,2)                                 AS amount_out,
  NULL::TEXT                                       AS po_no
FROM cash_movements cm
WHERE cm.to_account_type = 'vendor' AND cm.to_account_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
