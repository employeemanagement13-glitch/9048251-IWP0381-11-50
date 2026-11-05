-- ============================================================================
-- mdos_v17_remove_invoice_stock_checks.sql
--
-- The "Reserved" stock concept has been removed in the v9.1 Blueprint.
-- Delivery is no longer tracked as a separate workflow stage.
-- Invoices now represent delivered sales instantly. 
--
-- Therefore, we are completely removing the old invoice triggers that used to 
-- track reservations in the deprecated warehouse_stock table.
--
-- This also removes the rigid database constraint that was blocking invoice
-- creation with the error: "Insufficient stock for X: ordered Y, only Z available."
-- ============================================================================

-- 1. Drop the trigger that fires on new invoices
DROP TRIGGER IF EXISTS trg_reserve_stock_on_invoice ON invoices;

-- 2. Drop the trigger that fires on updated invoices
DROP TRIGGER IF EXISTS trg_update_reserved_on_invoice_edit ON invoices;

-- 3. (Optional) Drop the old functions themselves so they aren't lingering
DROP FUNCTION IF EXISTS reserve_stock_on_invoice();
DROP FUNCTION IF EXISTS update_reserved_on_invoice_edit();
