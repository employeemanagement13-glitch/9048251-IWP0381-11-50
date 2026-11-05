-- ============================================================================
-- MDOS v35 EMPLOYEE ROLE CHECK FIX
-- Widens the role check constraint on `employees` to include 'dvo' and 'operation_manager'.
-- ============================================================================

ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_role_check;
ALTER TABLE employees ADD CONSTRAINT employees_role_check
  CHECK (role IN ('dm', 'preseller', 'operation_manager', 'loader', 'dvo', 'driver', 'guard', 'office', 'other'));
