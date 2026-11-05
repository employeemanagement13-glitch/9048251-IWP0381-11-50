-- ============================================================================
-- MDOS v8 — FIX: Add user_id column to admin_logs for proper admin session tracking
-- Problem: All admins share tenant_id=null and is_mdos_user=true, causing session conflicts
-- Solution: Add user_id column to uniquely identify each admin user
-- ============================================================================

-- Add user_id column to admin_logs
alter table admin_logs add column if not exists user_id text;

-- Create index on user_id for faster queries
create index if not exists idx_admin_logs_user_id on admin_logs(user_id);

-- ============================================================================
-- END OF FIX
-- ============================================================================
