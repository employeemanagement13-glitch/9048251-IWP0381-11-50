-- ============================================================================
-- MDOS v8 — FIX: Ledger Cleanup Triggers
-- Problem: When invoices or ccbpl_purchases are deleted, ledger entries remain
-- Solution: Add triggers to delete orphaned ledger entries on source deletion
-- Run this AFTER day2_triggers.sql and mdos_v7_schema (2).sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. cleanup_ledger_on_invoice_delete()
-- Called AFTER DELETE on invoices. Removes corresponding ledger entries
-- that reference the deleted invoice.
-- ----------------------------------------------------------------------------

create or replace function cleanup_ledger_on_invoice_delete()
returns trigger
language plpgsql
security definer
as $$
begin
  delete from agency_ledger
  where ref_table = 'invoices'
    and ref_id = old.id;
  return old;
end;
$$;

drop trigger if exists trg_cleanup_ledger_on_invoice_delete on invoices;
create trigger trg_cleanup_ledger_on_invoice_delete
  after delete on invoices
  for each row execute function cleanup_ledger_on_invoice_delete();

-- ----------------------------------------------------------------------------
-- 2. cleanup_ledger_on_purchase_delete()
-- Called AFTER DELETE on ccbpl_purchases. Removes corresponding ledger entries
-- that reference the deleted purchase.
-- ----------------------------------------------------------------------------

create or replace function cleanup_ledger_on_purchase_delete()
returns trigger
language plpgsql
security definer
as $$
begin
  delete from agency_ledger
  where ref_table = 'ccbpl_purchases'
    and ref_id = old.id;
  return old;
end;
$$;

drop trigger if exists trg_cleanup_ledger_on_purchase_delete on ccbpl_purchases;
create trigger trg_cleanup_ledger_on_purchase_delete
  after delete on ccbpl_purchases
  for each row execute function cleanup_ledger_on_purchase_delete();

-- ============================================================================
-- END OF FIX
-- ============================================================================
