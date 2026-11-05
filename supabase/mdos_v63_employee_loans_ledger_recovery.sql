ALTER TABLE employee_loans ADD COLUMN IF NOT EXISTS bank_account_id UUID REFERENCES bank_accounts(id) ON DELETE SET NULL;
ALTER TABLE employee_loans ADD COLUMN IF NOT EXISTS repayment_type TEXT DEFAULT 'monthly_installments';

CREATE TABLE IF NOT EXISTS employee_loan_recoveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  loan_id UUID NOT NULL REFERENCES employee_loans(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  bank_account_id UUID REFERENCES bank_accounts(id) ON DELETE SET NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  recovery_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employee_loan_recoveries_loan ON employee_loan_recoveries(loan_id);
CREATE INDEX IF NOT EXISTS idx_employee_loan_recoveries_tenant ON employee_loan_recoveries(tenant_id);

ALTER TABLE employee_loan_recoveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS employee_loan_recoveries_owner_all ON employee_loan_recoveries;
CREATE POLICY employee_loan_recoveries_owner_all ON employee_loan_recoveries
  FOR ALL TO authenticated
  USING ( tenant_id = (SELECT current_tenant_id()) )
  WITH CHECK ( tenant_id = (SELECT current_tenant_id()) );

NOTIFY pgrst, 'reload schema';
