-- Migration: delete_tenant_cascade RPC function
-- Drops ALL data for a single tenant AND deletes the tenant row itself.
-- Runs in a single DB transaction so partial failures roll back cleanly.
-- Corrects stale wipe_tenant_data bugs (order_id -> sell_in_order_id, invoices_shop_id_fkey).

CREATE OR REPLACE FUNCTION delete_tenant_cascade(p_tenant_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'p_tenant_id cannot be null';
  END IF;

  -- =========================================================================
  -- 1. DEEPEST LEAF / JUNCTION TABLES
  -- =========================================================================

  -- Stock movements
  DELETE FROM stock_movements WHERE tenant_id = p_tenant_id;

  -- Sell-in leaf tables (sell_in_return_entries, sell_in_arrived_lines -> sell_in_lines)
  DELETE FROM sell_in_return_entries
  WHERE sell_in_line_id IN (
    SELECT sil.id FROM sell_in_lines sil
    JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id
    WHERE sio.tenant_id = p_tenant_id
  );

  DELETE FROM sell_in_arrived_lines
  WHERE sell_in_line_id IN (
    SELECT sil.id FROM sell_in_lines sil
    JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id
    WHERE sio.tenant_id = p_tenant_id
  );

  -- Sell-in lines
  DELETE FROM sell_in_lines
  WHERE sell_in_order_id IN (
    SELECT id FROM sell_in_orders WHERE tenant_id = p_tenant_id
  );

  -- Invoice children (delete for invoices of this tenant OR referencing this tenant's shops)
  DELETE FROM invoice_line_items
  WHERE invoice_id IN (
    SELECT id FROM invoices WHERE tenant_id = p_tenant_id
    UNION
    SELECT id FROM invoices WHERE shop_id IN (SELECT id FROM shops WHERE tenant_id = p_tenant_id)
  );

  DELETE FROM invoice_returns
  WHERE invoice_id IN (
    SELECT id FROM invoices WHERE tenant_id = p_tenant_id
    UNION
    SELECT id FROM invoices WHERE shop_id IN (SELECT id FROM shops WHERE tenant_id = p_tenant_id)
  );

  -- Stock audit children
  DELETE FROM stock_discrepancies
  WHERE audit_id IN (
    SELECT id FROM stock_audits WHERE tenant_id = p_tenant_id
  );

  -- =========================================================================
  -- 2. TRANSACTIONAL & OPERATIONAL (INVOICES & EMPTIES before SHOPS)
  -- =========================================================================

  DELETE FROM shop_payments WHERE tenant_id = p_tenant_id;
  DELETE FROM late_deliveries WHERE tenant_id = p_tenant_id;
  DELETE FROM sale_entry_lines WHERE tenant_id = p_tenant_id;
  DELETE FROM sale_entries WHERE tenant_id = p_tenant_id;
  DELETE FROM stock_report_entries WHERE tenant_id = p_tenant_id;

  -- Empties & Wayback returns before invoices/shops
  DELETE FROM empties_log
  WHERE tenant_id = p_tenant_id
     OR shop_id IN (SELECT id FROM shops WHERE tenant_id = p_tenant_id);

  DELETE FROM returns_wayback
  WHERE tenant_id = p_tenant_id
     OR shop_id IN (SELECT id FROM shops WHERE tenant_id = p_tenant_id);

  -- Delete all invoices for this tenant OR referencing this tenant's shops
  DELETE FROM invoices
  WHERE tenant_id = p_tenant_id
     OR shop_id IN (SELECT id FROM shops WHERE tenant_id = p_tenant_id);

  -- Safety net: break any remaining FK references from invoices to shops
  UPDATE invoices SET shop_id = NULL
  WHERE shop_id IN (SELECT id FROM shops WHERE tenant_id = p_tenant_id);

  DELETE FROM sell_in_orders WHERE tenant_id = p_tenant_id;
  DELETE FROM route_assignments WHERE tenant_id = p_tenant_id;
  DELETE FROM stock_audits WHERE tenant_id = p_tenant_id;
  DELETE FROM damaged_stock WHERE tenant_id = p_tenant_id;
  DELETE FROM warehouse_stock WHERE tenant_id = p_tenant_id;
  DELETE FROM leased_empties WHERE tenant_id = p_tenant_id;
  DELETE FROM sold_empties WHERE tenant_id = p_tenant_id;
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
  DELETE FROM vehicle_maintenance WHERE tenant_id = p_tenant_id;
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
  -- 5. MASTER / REGISTRY (SHOPS after invoices & dependents are cleared)
  -- =========================================================================

  DELETE FROM loaders WHERE tenant_id = p_tenant_id;
  DELETE FROM dm_routes WHERE tenant_id = p_tenant_id;

  -- Ensure any stray FK links to shops are nullified before deleting shops
  UPDATE invoices SET shop_id = NULL
  WHERE shop_id IN (SELECT id FROM shops WHERE tenant_id = p_tenant_id);

  DELETE FROM shops WHERE tenant_id = p_tenant_id;
  DELETE FROM employees WHERE tenant_id = p_tenant_id;
  DELETE FROM vendor_accounts WHERE tenant_id = p_tenant_id;
  DELETE FROM bank_accounts WHERE tenant_id = p_tenant_id;
  DELETE FROM products WHERE tenant_id = p_tenant_id;
  DELETE FROM product_categories WHERE tenant_id = p_tenant_id;

  -- =========================================================================
  -- 6. TENANT CONFIG (No 'users' table - Clerk manages users externally)
  -- =========================================================================

  DELETE FROM tenant_feature_flags WHERE tenant_id = p_tenant_id;
  DELETE FROM tenant_alert_settings WHERE tenant_id = p_tenant_id;

  -- =========================================================================
  -- 7. DELETE THE TENANT ROW ITSELF
  -- =========================================================================

  DELETE FROM tenants WHERE id = p_tenant_id;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Tenant and all associated data deleted successfully',
    'tenant_id', p_tenant_id
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Failed to delete tenant: %', SQLERRM;
END;
$$;
