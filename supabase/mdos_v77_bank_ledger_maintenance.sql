-- ============================================================================
-- MDOS v77: Restore vehicle_maintenance in bank_account_ledger
--
-- v55 added maintenance to the ledger. v59 and v62 rebuilt the view and kept
-- fuel but dropped maintenance. This recreates the v62 view body and puts the
-- maintenance UNION back (same shape as fuel).
-- ============================================================================

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
  vm.tenant_id,
  vm.bank_account_id,
  vm.entry_date                                     AS txn_date,
  'Expense'::TEXT                                   AS txn_type,
  COALESCE(vm.vehicle_no, '') || ' | ' || COALESCE(vm.driver_name, '') || ' | Maintenance' AS reference,
  0::NUMERIC(14,2)                                  AS amount_in,
  COALESCE(vm.amount, 0)::NUMERIC(14,2)             AS amount_out,
  NULL::TEXT                                        AS po_no
FROM vehicle_maintenance vm
WHERE vm.bank_account_id IS NOT NULL

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
WHERE cm.to_account_type = 'transaction' AND cm.to_account_id IS NOT NULL

UNION ALL

SELECT
  le.tenant_id,
  le.bank_account_id,
  le.from_date                                     AS txn_date,
  'Expense'::TEXT                                  AS txn_type,
  le.from_date::TEXT || ' - ' || le.to_date::TEXT || ' | ' || COALESCE(le.work, '') AS reference,
  0::NUMERIC(14,2)                                 AS amount_in,
  COALESCE(le.amount, 0)::NUMERIC(14,2)            AS amount_out,
  NULL::TEXT                                       AS po_no
FROM laborer_expenses le
WHERE le.bank_account_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
