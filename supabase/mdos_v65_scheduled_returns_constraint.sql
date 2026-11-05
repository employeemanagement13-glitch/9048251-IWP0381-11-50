-- mdos_v65_scheduled_returns_constraint.sql
-- Allow monthly_installment to be 0 for scheduled_returns loans
ALTER TABLE employee_loans DROP CONSTRAINT IF EXISTS employee_loans_monthly_installment_check;
ALTER TABLE employee_loans ADD CONSTRAINT employee_loans_monthly_installment_check CHECK (monthly_installment >= 0);

NOTIFY pgrst, 'reload schema';
