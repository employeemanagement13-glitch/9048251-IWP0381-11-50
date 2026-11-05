-- Migration v40: Add bank_account_id and expense_date columns to expense tables & update bank_account_ledger view

ALTER TABLE payroll_runs          ADD COLUMN IF NOT EXISTS bank_account_id UUID REFERENCES bank_accounts(id) ON DELETE SET NULL;
ALTER TABLE payroll_runs          ADD COLUMN IF NOT EXISTS expense_date DATE DEFAULT CURRENT_DATE;

ALTER TABLE fuel_entries          ADD COLUMN IF NOT EXISTS bank_account_id UUID REFERENCES bank_accounts(id) ON DELETE SET NULL;

ALTER TABLE expense_bills         ADD COLUMN IF NOT EXISTS bank_account_id UUID REFERENCES bank_accounts(id) ON DELETE SET NULL;
ALTER TABLE expense_bills         ADD COLUMN IF NOT EXISTS expense_date DATE DEFAULT CURRENT_DATE;

ALTER TABLE expense_entertainment   ADD COLUMN IF NOT EXISTS bank_account_id UUID REFERENCES bank_accounts(id) ON DELETE SET NULL;
ALTER TABLE expense_entertainment   ADD COLUMN IF NOT EXISTS expense_date DATE DEFAULT CURRENT_DATE;

ALTER TABLE expense_petty         ADD COLUMN IF NOT EXISTS bank_account_id UUID REFERENCES bank_accounts(id) ON DELETE SET NULL;
ALTER TABLE expense_petty         ADD COLUMN IF NOT EXISTS expense_date DATE DEFAULT CURRENT_DATE;

ALTER TABLE expense_penalties     ADD COLUMN IF NOT EXISTS bank_account_id UUID REFERENCES bank_accounts(id) ON DELETE SET NULL;
ALTER TABLE expense_penalties     ADD COLUMN IF NOT EXISTS expense_date DATE DEFAULT CURRENT_DATE;

-- Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';

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
WHERE sio.status = 'billed' AND sio.paid_from_bank_account_id IS NOT NULL

UNION ALL

-- 1. Payroll Runs (Salary)
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

-- 2. Fuel Entries
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

-- 3. Bills
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

-- 4. Entertainment
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

-- 5. Petty Cash
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

-- 6. Penalties
SELECT
  epn.tenant_id,
  epn.bank_account_id,
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
  'Expense'::TEXT                                   AS txn_type,
  COALESCE(epn.description, '') || ' | Penalty'      AS reference,
  0::NUMERIC(14,2)                                  AS amount_in,
  COALESCE(epn.amount, 0)::NUMERIC(14,2)            AS amount_out,
  NULL::TEXT                                        AS po_no
FROM expense_penalties epn
WHERE epn.bank_account_id IS NOT NULL;
