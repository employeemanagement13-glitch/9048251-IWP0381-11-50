-- ============================================================================
-- MDOS v69: ADD 'lifter_operator' TO employees_role_check CONSTRAINT
--
-- Fixes error:
--   violates check constraint "employees_role_check"
-- when importing or saving employees with role "Lifter Operator" ('lifter_operator').
-- ============================================================================

ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_role_check;

ALTER TABLE employees ADD CONSTRAINT employees_role_check
  CHECK (role IN (
    'dm',
    'preseller',
    'operation_manager',
    'loader',
    'lifter_operator',
    'dvo',
    'driver',
    'guard',
    'office',
    'other'
  ));
