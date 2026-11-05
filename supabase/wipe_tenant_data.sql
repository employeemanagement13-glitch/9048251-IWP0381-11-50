-- Migration: wipe_tenant_data RPC function
-- Safely drops all operational, transactional, and prerequisite data for a single tenant.
-- DOES NOT TRUNCATE, DOES NOT DELETE FROM tenants, users, admins, admin_logs, backups, global tables.

CREATE OR REPLACE FUNCTION wipe_tenant_data(p_tenant_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'p_tenant_id cannot be null';
  END IF;

  -- =========================================================================
  -- 1. CHILD / LEAF JUNCTION TABLES (Reverse Foreign Key Order)
  -- =========================================================================

  -- Stock movements
  DELETE FROM stock_movements WHERE tenant_id = p_tenant_id;

  -- Sell-in returns & arrived lines
  DELETE FROM sell_in_return_entries
  WHERE sell_in_line_id IN (
    SELECT sil.id FROM sell_in_lines sil
    JOIN sell_in_orders sio ON sio.id = sil.order_id
    WHERE sio.tenant_id = p_tenant_id
  );

  DELETE FROM sell_in_arrived_lines
  WHERE sell_in_line_id IN (
    SELECT sil.id FROM sell_in_lines sil
    JOIN sell_in_orders sio ON sio.id = sil.order_id
    WHERE sio.tenant_id = p_tenant_id
  );

  -- Sell-in lines
  DELETE FROM sell_in_lines
  WHERE order_id IN (
    SELECT id FROM sell_in_orders WHERE tenant_id = p_tenant_id
  );

  -- Invoice line items & returns
  DELETE FROM invoice_line_items
  WHERE invoice_id IN (
    SELECT id FROM invoices WHERE tenant_id = p_tenant_id
  );

  DELETE FROM invoice_returns
  WHERE invoice_id IN (
    SELECT id FROM invoices WHERE tenant_id = p_tenant_id
  );

  -- Stock audit discrepancies
  DELETE FROM stock_discrepancies
  WHERE audit_id IN (
    SELECT id FROM stock_audits WHERE tenant_id = p_tenant_id
  );

  -- Shop payments
  DELETE FROM shop_payments
  WHERE tenant_id = p_tenant_id;

  -- Late delivery tracking
  DELETE FROM late_deliveries
  WHERE tenant_id = p_tenant_id;

  -- =========================================================================
  -- 2. TRANSACTIONAL & OPERATIONAL TABLES
  -- =========================================================================

  -- Invoices & Wayback returns
  DELETE FROM invoices WHERE tenant_id = p_tenant_id;
  DELETE FROM returns_wayback WHERE tenant_id = p_tenant_id;

  -- Sell-in orders
  DELETE FROM sell_in_orders WHERE tenant_id = p_tenant_id;

  -- Route assignments
  DELETE FROM route_assignments WHERE tenant_id = p_tenant_id;

  -- Stock audits & Inventory logs
  DELETE FROM stock_audits WHERE tenant_id = p_tenant_id;
  DELETE FROM damaged_stock WHERE tenant_id = p_tenant_id;
  DELETE FROM empties_log WHERE tenant_id = p_tenant_id;
  DELETE FROM warehouse_stock WHERE tenant_id = p_tenant_id;

  -- Cash deposits & Alerts
  DELETE FROM cash_deposits WHERE tenant_id = p_tenant_id;
  DELETE FROM alerts WHERE tenant_id = p_tenant_id;

  -- =========================================================================
  -- 3. EXPENSES, CCBPL & SCHEME INCOME
  -- =========================================================================

  DELETE FROM expense_bills WHERE tenant_id = p_tenant_id;
  DELETE FROM expense_entertainment WHERE tenant_id = p_tenant_id;
  DELETE FROM expense_petty WHERE tenant_id = p_tenant_id;
  DELETE FROM expense_penalties WHERE tenant_id = p_tenant_id;
  DELETE FROM fuel_entries WHERE tenant_id = p_tenant_id;
  DELETE FROM agency_expenses WHERE tenant_id = p_tenant_id;
  DELETE FROM ccbpl_penalties WHERE tenant_id = p_tenant_id;
  DELETE FROM ccbpl_purchases WHERE tenant_id = p_tenant_id;
  DELETE FROM scheme_income WHERE tenant_id = p_tenant_id;

  -- =========================================================================
  -- 4. PAYROLL & HR RECORDS
  -- =========================================================================

  DELETE FROM payroll_runs WHERE tenant_id = p_tenant_id;
  DELETE FROM payroll_sops WHERE tenant_id = p_tenant_id;
  DELETE FROM employee_ledger WHERE tenant_id = p_tenant_id;
  DELETE FROM employee_loans WHERE tenant_id = p_tenant_id;
  DELETE FROM employee_increments WHERE tenant_id = p_tenant_id;

  -- =========================================================================
  -- 5. MASTER / PREREQUISITE REGISTRY RECORDS
  -- =========================================================================

  DELETE FROM dm_routes WHERE tenant_id = p_tenant_id;
  DELETE FROM shops WHERE tenant_id = p_tenant_id;
  DELETE FROM products WHERE tenant_id = p_tenant_id;
  DELETE FROM product_categories WHERE tenant_id = p_tenant_id;
  DELETE FROM employees WHERE tenant_id = p_tenant_id;
  DELETE FROM vendor_accounts WHERE tenant_id = p_tenant_id;
  DELETE FROM bank_accounts WHERE tenant_id = p_tenant_id;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'All operational and master data wiped for tenant successfully',
    'tenant_id', p_tenant_id
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Failed to wipe tenant data: %', SQLERRM;
END;
$$;