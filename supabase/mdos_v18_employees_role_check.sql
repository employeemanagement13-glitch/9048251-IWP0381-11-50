-- Drop the existing constraint
ALTER TABLE employees DROP CONSTRAINT employees_role_check;

-- Add the new constraint with all supported UI roles
ALTER TABLE employees ADD CONSTRAINT employees_role_check 
CHECK (role IN ('dm', 'preseller', 'operation_manager', 'loader', 'dvo', 'driver', 'guard', 'office', 'other'));
