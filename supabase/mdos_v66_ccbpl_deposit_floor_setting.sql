-- mdos_v66_ccbpl_deposit_floor_setting.sql
-- Adds ccbpl_deposit_floor to tenant_settings so each distributor can configure
-- their own CCBPL minimum deposit requirement (varies by distributor contract).
-- Default = 40,000,000 (standard CCBPL requirement).

ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS ccbpl_deposit_floor NUMERIC(18,2) NOT NULL DEFAULT 40000000;

COMMENT ON COLUMN tenant_settings.ccbpl_deposit_floor IS
  'Minimum CCBPL account balance required per distributor contract (security deposit floor). '
  'Used to split vendor_accounts.current_balance into deposit asset vs trade payable on the Balance Sheet. '
  'Default: Rs. 40,000,000. Set by distributor in /settings page.';
