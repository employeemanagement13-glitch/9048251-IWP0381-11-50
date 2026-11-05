-- ============================================================================
-- MDOS — Enable Supabase Realtime on tables used for real-time sync
--
-- Run this ONCE in the Supabase SQL Editor after applying all schema files.
-- Adds the four tables that drive admin-to-distribution real-time updates
-- to the supabase_realtime publication so that postgres_changes events
-- are broadcast to subscribed clients.
-- ============================================================================

-- Tab/page permission flags (global and per-tenant)
alter publication supabase_realtime add table global_feature_flags;
alter publication supabase_realtime add table tenant_feature_flags;

-- Global alert enable/disable (admin → distributor settings)
alter publication supabase_realtime add table global_alert_settings;

-- Access log entries (distributor page visits → admin logs page)
alter publication supabase_realtime add table admin_logs;

-- ============================================================================
-- END
-- ============================================================================
