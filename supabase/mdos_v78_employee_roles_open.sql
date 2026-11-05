-- ============================================================================
-- MDOS v78: Allow custom employee roles from Excel import
--
-- Previously employees_role_check only allowed a fixed list. Unknown Excel
-- Role cells were forced to 'dm' or failed the insert. This opens the check
-- so any non-empty role slug can be stored; the directory filter pills then
-- show whatever roles exist on staff.
-- ============================================================================

ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_role_check;

ALTER TABLE employees ADD CONSTRAINT employees_role_check
  CHECK (role IS NOT NULL AND length(trim(role)) > 0);

NOTIFY pgrst, 'reload schema';
