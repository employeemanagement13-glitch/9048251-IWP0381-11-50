-- ============================================================================
-- MDOS v8 — FIX: Add tab0 flag for Prerequisites section
-- Problem: Tab 0 (Prerequisites) has no global flag, so it never shows in sidebar
-- Solution: Add tab0 flag to control the entire tab (Shop Details & Employees)
-- ============================================================================

insert into global_feature_flags (flag_key, label, enabled)
values ('tab0', 'Tab 0 — Prerequisites (Shop Details & Employees)', true)
on conflict (flag_key) do update set enabled = true;

-- Remove individual page flags if they exist (no longer needed)
-- First delete tenant overrides, then delete global flags
delete from tenant_feature_flags where flag_key in ('shop_details', 'employees');
delete from global_feature_flags where flag_key in ('shop_details', 'employees');

-- ============================================================================
-- END OF FIX
-- ============================================================================
