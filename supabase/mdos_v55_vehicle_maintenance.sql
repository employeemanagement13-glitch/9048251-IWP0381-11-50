-- ============================================================================
-- MDOS v55: Vehicle Maintenance Head and Bank Account Ledger Integration
-- ============================================================================

CREATE TABLE IF NOT EXISTS vehicle_maintenance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  vehicle_no text NOT NULL,
  driver_name text,
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  description text NOT NULL,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  bank_account_id uuid REFERENCES bank_accounts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_maintenance_tenant_vehicle
  ON vehicle_maintenance(tenant_id, vehicle_no);

CREATE INDEX IF NOT EXISTS idx_vehicle_maintenance_entry_date
  ON vehicle_maintenance(entry_date);

ALTER TABLE vehicle_maintenance ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'vehicle_maintenance' AND policyname = 'tenant_isolation_vehicle_maintenance'
  ) THEN
    CREATE POLICY tenant_isolation_vehicle_maintenance ON vehicle_maintenance
      AS PERMISSIVE FOR ALL
      USING (tenant_id = (SELECT auth.jwt()->>'tenant_id')::uuid)
      WITH CHECK (tenant_id = (SELECT auth.jwt()->>'tenant_id')::uuid);
  END IF;
END $$;

DROP VIEW IF EXISTS bank_account_ledger CASCADE;

CREATE VIEW bank_account_ledger WITH (security_invoker = TRUE) AS
SELECT
  cd.tenant_id,
  cd.bank_account_id,
  cd.deposit_date                                  AS txn_date,
  'Deposit'::TEXT                                  AS txn_type,
  COALESCE(cd.bank_ref_no, 'Cash Deposit')         AS reference,
  cd.amount::NUMERIC(14,2)                         AS amount_in,
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
  sp.amount::NUMERIC(14,2)                         AS amount_in,
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
  COALESCE(
    CASE
      WHEN sio.paid_amount IS NOT NULL AND sio.paid_amount > 0 THEN sio.paid_amount
      ELSE (
        SELECT SUM(CASE WHEN invoice_type='purchase' THEN COALESCE(bill_amount, net_bill_amount, rate * qty) ELSE -COALESCE(bill_amount, net_bill_amount, rate * qty) END)
        FROM sell_in_lines WHERE sell_in_order_id = sio.id
      )
    END,
    0
  )::NUMERIC(14,2)                                 AS amount_out,
  sio.po_no
FROM sell_in_orders sio
WHERE sio.status = 'billed' AND sio.paid_from_bank_account_id IS NOT NULL

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
  COALESCE(ep.description, '') || ' | Petty'        AS reference,
  0::NUMERIC(14,2)                                  AS amount_in,
  COALESCE(ep.amount, 0)::NUMERIC(14,2)             AS amount_out,
  NULL::TEXT                                        AS po_no
FROM expense_petty ep
WHERE ep.bank_account_id IS NOT NULL

UNION ALL

SELECT
  epa.tenant_id,
  epa.bank_account_id,
  COALESCE(epa.expense_date, (epa.year || '-' || CASE
    WHEN LOWER(epa.month) IN ('january','jan') THEN '01'
    WHEN LOWER(epa.month) IN ('february','feb') THEN '02'
    WHEN LOWER(epa.month) IN ('march','mar') THEN '03'
    WHEN LOWER(epa.month) IN ('april','apr') THEN '04'
    WHEN LOWER(epa.month) IN ('may') THEN '05'
    WHEN LOWER(epa.month) IN ('june','jun') THEN '06'
    WHEN LOWER(epa.month) IN ('july','jul') THEN '07'
    WHEN LOWER(epa.month) IN ('august','aug') THEN '08'
    WHEN LOWER(epa.month) IN ('september','sep') THEN '09'
    WHEN LOWER(epa.month) IN ('october','oct') THEN '10'
    WHEN LOWER(epa.month) IN ('november','nov') THEN '11'
    WHEN LOWER(epa.month) IN ('december','dec') THEN '12'
    ELSE '01'
  END || '-01')::DATE)                               AS txn_date,
  'Expense'::TEXT                                   AS txn_type,
  COALESCE(epa.description, '') || ' | Penalty'     AS reference,
  0::NUMERIC(14,2)                                  AS amount_in,
  COALESCE(epa.amount, 0)::NUMERIC(14,2)            AS amount_out,
  NULL::TEXT                                        AS po_no
FROM expense_penalties epa
WHERE epa.bank_account_id IS NOT NULL

UNION ALL

SELECT
  si.tenant_id,
  si.bank_account_id,
  COALESCE(si.income_date, (si.income_month || '-01')::DATE) AS txn_date,
  'Scheme Income'::TEXT                                     AS txn_type,
  COALESCE(si.description, 'Scheme Income') || ' | Scheme Income' AS reference,
  COALESCE(si.amount, 0)::NUMERIC(14,2)                      AS amount_in,
  0::NUMERIC(14,2)                                          AS amount_out,
  NULL::TEXT                                                AS po_no
FROM scheme_income si
WHERE si.bank_account_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
