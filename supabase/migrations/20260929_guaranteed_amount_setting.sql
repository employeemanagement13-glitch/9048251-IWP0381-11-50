-- Migration: 20260929_guaranteed_amount_setting.sql
-- Adds guaranteed_amount to tenant_settings for CCBPL Trade Payable calculation in Balance Sheet

ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS guaranteed_amount NUMERIC(18,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN tenant_settings.guaranteed_amount IS
  'Guaranteed amount provided to CCBPL (bank guarantee / security guarantee). '
  'Used in Balance Sheet: CCBPL Trade Payable = Used - Guarantee. '
  'Default: 0. Configured by distributor in /settings page.';
