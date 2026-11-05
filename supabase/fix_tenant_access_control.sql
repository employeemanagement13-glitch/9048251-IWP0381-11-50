-- ============================================================================
-- MDOS v8 — FIX: Tenant Access Control
-- Problem: RLS policies only check tenant_id but not access_enabled
-- Solution: Add helper function and update all tenant-isolation policies
-- Run this AFTER mdos_v8_all_fixes.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Create helper function to check if tenant is enabled
-- ----------------------------------------------------------------------------
create or replace function is_tenant_enabled()
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from tenants 
    where id = (select current_tenant_id()) 
      and access_enabled = true
  );
$$;

-- ----------------------------------------------------------------------------
-- 2. Update all tenant-isolation RLS policies to check access_enabled
-- ----------------------------------------------------------------------------

-- employees
drop policy if exists employees_owner_all on employees;
create policy employees_owner_all on employees for all
  to authenticated
  using ( tenant_id = (select current_tenant_id()) and (select is_tenant_enabled()) )
  with check ( tenant_id = (select current_tenant_id()) and (select is_tenant_enabled()) );

-- shops
drop policy if exists shops_owner_all on shops;
create policy shops_owner_all on shops for all
  to authenticated
  using ( tenant_id = (select current_tenant_id()) and (select is_tenant_enabled()) )
  with check ( tenant_id = (select current_tenant_id()) and (select is_tenant_enabled()) );

-- invoices
drop policy if exists invoices_owner_all on invoices;
create policy invoices_owner_all on invoices for all
  to authenticated
  using ( tenant_id = (select current_tenant_id()) and (select is_tenant_enabled()) )
  with check ( tenant_id = (select current_tenant_id()) and (select is_tenant_enabled()) );

-- empties_log
drop policy if exists empties_log_owner_all on empties_log;
create policy empties_log_owner_all on empties_log for all
  to authenticated
  using ( tenant_id = (select current_tenant_id()) and (select is_tenant_enabled()) )
  with check ( tenant_id = (select current_tenant_id()) and (select is_tenant_enabled()) );

-- warehouse_stock
drop policy if exists warehouse_stock_owner_all on warehouse_stock;
create policy warehouse_stock_owner_all on warehouse_stock for all
  to authenticated
  using ( tenant_id = (select current_tenant_id()) and (select is_tenant_enabled()) )
  with check ( tenant_id = (select current_tenant_id()) and (select is_tenant_enabled()) );

-- dm_routes
drop policy if exists dm_routes_owner_all on dm_routes;
create policy dm_routes_owner_all on dm_routes for all
  to authenticated
  using ( tenant_id = (select current_tenant_id()) and (select is_tenant_enabled()) )
  with check ( tenant_id = (select current_tenant_id()) and (select is_tenant_enabled()) );

-- route_assignments
drop policy if exists route_assignments_owner_all on route_assignments;
create policy route_assignments_owner_all on route_assignments for all
  to authenticated
  using ( tenant_id = (select current_tenant_id()) and (select is_tenant_enabled()) )
  with check ( tenant_id = (select current_tenant_id()) and (select is_tenant_enabled()) );

-- late_deliveries
drop policy if exists late_deliveries_owner_all on late_deliveries;
create policy late_deliveries_owner_all on late_deliveries for all
  to authenticated
  using ( tenant_id = (select current_tenant_id()) and (select is_tenant_enabled()) )
  with check ( tenant_id = (select current_tenant_id()) and (select is_tenant_enabled()) );

-- damaged_stock
drop policy if exists damaged_stock_owner_all on damaged_stock;
create policy damaged_stock_owner_all on damaged_stock for all
  to authenticated
  using ( tenant_id = (select current_tenant_id()) and (select is_tenant_enabled()) )
  with check ( tenant_id = (select current_tenant_id()) and (select is_tenant_enabled()) );

-- returns_wayback
drop policy if exists returns_wayback_owner_all on returns_wayback;
create policy returns_wayback_owner_all on returns_wayback for all
  to authenticated
  using ( tenant_id = (select current_tenant_id()) and (select is_tenant_enabled()) )
  with check ( tenant_id = (select current_tenant_id()) and (select is_tenant_enabled()) );

-- stock_audits
drop policy if exists stock_audits_owner_all on stock_audits;
create policy stock_audits_owner_all on stock_audits for all
  to authenticated
  using ( tenant_id = (select current_tenant_id()) and (select is_tenant_enabled()) )
  with check ( tenant_id = (select current_tenant_id()) and (select is_tenant_enabled()) );

-- stock_discrepancies
drop policy if exists stock_discrepancies_owner_all on stock_discrepancies;
create policy stock_discrepancies_owner_all on stock_discrepancies for all
  to authenticated
  using ( tenant_id = (select current_tenant_id()) and (select is_tenant_enabled()) )
  with check ( tenant_id = (select current_tenant_id()) and (select is_tenant_enabled()) );

-- cash_deposits
drop policy if exists cash_deposits_owner_all on cash_deposits;
create policy cash_deposits_owner_all on cash_deposits for all
  to authenticated
  using ( tenant_id = (select current_tenant_id()) and (select is_tenant_enabled()) )
  with check ( tenant_id = (select current_tenant_id()) and (select is_tenant_enabled()) );

-- agency_ledger
drop policy if exists agency_ledger_owner_all on agency_ledger;
create policy agency_ledger_owner_all on agency_ledger for all
  to authenticated
  using ( tenant_id = (select current_tenant_id()) and (select is_tenant_enabled()) )
  with check ( tenant_id = (select current_tenant_id()) and (select is_tenant_enabled()) );

-- ccbpl_ledger
drop policy if exists ccbpl_ledger_owner_all on ccbpl_ledger;
create policy ccbpl_ledger_owner_all on ccbpl_ledger for all
  to authenticated
  using ( tenant_id = (select current_tenant_id()) and (select is_tenant_enabled()) )
  with check ( tenant_id = (select current_tenant_id()) and (select is_tenant_enabled()) );

-- ccbpl_purchases
drop policy if exists ccbpl_purchases_owner_all on ccbpl_purchases;
create policy ccbpl_purchases_owner_all on ccbpl_purchases for all
  to authenticated
  using ( tenant_id = (select current_tenant_id()) and (select is_tenant_enabled()) )
  with check ( tenant_id = (select current_tenant_id()) and (select is_tenant_enabled()) );

-- agency_expenses
drop policy if exists agency_expenses_owner_all on agency_expenses;
create policy agency_expenses_owner_all on agency_expenses for all
  to authenticated
  using ( tenant_id = (select current_tenant_id()) and (select is_tenant_enabled()) )
  with check ( tenant_id = (select current_tenant_id()) and (select is_tenant_enabled()) );

-- ccbpl_penalties
drop policy if exists ccbpl_penalties_owner_all on ccbpl_penalties;
create policy ccbpl_penalties_owner_all on ccbpl_penalties for all
  to authenticated
  using ( tenant_id = (select current_tenant_id()) and (select is_tenant_enabled()) )
  with check ( tenant_id = (select current_tenant_id()) and (select is_tenant_enabled()) );

-- backups
drop policy if exists backups_owner_all on backups;
create policy backups_owner_all on backups for all
  to authenticated
  using ( tenant_id = (select current_tenant_id()) and (select is_tenant_enabled()) )
  with check ( tenant_id = (select current_tenant_id()) and (select is_tenant_enabled()) );

-- alerts (select only - system-generated inserts)
drop policy if exists alerts_select on alerts;
create policy alerts_select on alerts for select
  to authenticated
  using ( tenant_id = (select current_tenant_id()) and (select is_tenant_enabled()) );

drop policy if exists alerts_mark_read on alerts;
create policy alerts_mark_read on alerts for update
  to authenticated
  using ( tenant_id = (select current_tenant_id()) and (select is_tenant_enabled()) )
  with check ( tenant_id = (select current_tenant_id()) and (select is_tenant_enabled()) );

-- tenant_alert_settings
drop policy if exists tenant_alert_settings_owner_rw on tenant_alert_settings;
create policy tenant_alert_settings_owner_rw on tenant_alert_settings for all
  to authenticated
  using ( (tenant_id = (select current_tenant_id()) and (select is_tenant_enabled())) or (select is_platform_admin()) )
  with check ( (tenant_id = (select current_tenant_id()) and (select is_tenant_enabled())) or (select is_platform_admin()) );

-- tenant_settings
drop policy if exists tenant_settings_owner_rw on tenant_settings;
create policy tenant_settings_owner_rw on tenant_settings for all
  to authenticated
  using ( (tenant_id = (select current_tenant_id()) and (select is_tenant_enabled())) or (select is_platform_admin()) )
  with check ( (tenant_id = (select current_tenant_id()) and (select is_tenant_enabled())) or (select is_platform_admin()) );

-- tenant_feature_flags
drop policy if exists tenant_feature_flags_select on tenant_feature_flags;
create policy tenant_feature_flags_select on tenant_feature_flags for select
  to authenticated
  using ( (tenant_id = (select current_tenant_id()) and (select is_tenant_enabled())) or (select is_platform_admin()) );

drop policy if exists tenant_feature_flags_write on tenant_feature_flags;
create policy tenant_feature_flags_write on tenant_feature_flags for all
  to authenticated
  using ( (select is_platform_admin()) )
  with check ( (select is_platform_admin()) );

-- ============================================================================
-- END OF FIX
-- ============================================================================
