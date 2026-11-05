-- ============================================================================
-- MDOS — V15 ALERTS REALTIME FIX
--
-- This script adds the "alerts" table to the supabase_realtime publication.
-- Without this, the frontend (tab7/alerts) cannot receive postgres_changes
-- events via WebSockets, breaking the real-time feed functionality.
-- ============================================================================

alter publication supabase_realtime add table alerts;
