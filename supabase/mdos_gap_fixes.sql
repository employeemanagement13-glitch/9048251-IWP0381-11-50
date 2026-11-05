-- ============================================================================
-- MDOS v9.1 — Gap Fixes (run after mdos_v19_reports.sql)
--
-- Fixes:
--   GAP-1: Route payroll runs through ledger_entries (double-entry)
--   GAP-2: Route invoice delivery through ledger_entries (double-entry)
--   GAP-3: invoice_line_items.unit_rate uses products.sale_rate (not proportional)
-- ============================================================================


-- ============================================================================
-- GAP-1: PAYROLL → ledger_entries
--   Replaces the agency_ledger-only post_payroll_to_ledger trigger.
--   Now posts BOTH to agency_ledger (legacy, kept) AND ledger_entries (new).
--   DELETE cleanup also removes from ledger_entries.
-- ============================================================================

CREATE OR REPLACE FUNCTION post_payroll_to_ledger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $fn$
DECLARE v_name TEXT;
BEGIN
  SELECT full_name INTO v_name FROM employees WHERE id = NEW.employee_id;

  INSERT INTO agency_ledger (tenant_id, entry_date, description, amount, entry_type, ref_table, ref_id)
  VALUES (
    NEW.tenant_id, CURRENT_DATE,
    'Payroll ' || COALESCE(v_name,'Unknown') || ' ' || TO_CHAR(NEW.salary_month,'Mon YYYY'),
    -NEW.net_payable, 'expense', 'payroll_runs', NEW.id
  );

  INSERT INTO ledger_entries (tenant_id, account_code, entry_date, debit, credit, source_table, source_id, description)
  VALUES
    (NEW.tenant_id, 'EXP_SALARY', CURRENT_DATE, NEW.net_payable, 0,
     'payroll_runs', NEW.id,
     'Salary ' || COALESCE(v_name,'Unknown') || ' ' || TO_CHAR(NEW.salary_month,'Mon YYYY')),
    (NEW.tenant_id, 'CASH',       CURRENT_DATE, 0, NEW.net_payable,
     'payroll_runs', NEW.id,
     'Salary paid ' || COALESCE(v_name,'Unknown') || ' ' || TO_CHAR(NEW.salary_month,'Mon YYYY'));

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_post_payroll_to_ledger ON payroll_runs;
CREATE TRIGGER trg_post_payroll_to_ledger
  AFTER INSERT ON payroll_runs
  FOR EACH ROW EXECUTE FUNCTION post_payroll_to_ledger();


CREATE OR REPLACE FUNCTION cleanup_ledger_on_payroll_delete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $fn$
BEGIN
  DELETE FROM agency_ledger   WHERE ref_table = 'payroll_runs' AND ref_id = OLD.id;
  DELETE FROM ledger_entries  WHERE source_table = 'payroll_runs' AND source_id = OLD.id;
  RETURN OLD;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_cleanup_ledger_on_payroll_delete ON payroll_runs;
CREATE TRIGGER trg_cleanup_ledger_on_payroll_delete
  AFTER DELETE ON payroll_runs
  FOR EACH ROW EXECUTE FUNCTION cleanup_ledger_on_payroll_delete();

-- Backfill existing payroll runs into ledger_entries (safe, NOT EXISTS guard)
INSERT INTO ledger_entries (tenant_id, account_code, entry_date, debit, credit, source_table, source_id, description)
SELECT
  pr.tenant_id, 'EXP_SALARY', pr.created_at::date, pr.net_payable, 0,
  'payroll_runs', pr.id,
  'Salary ' || COALESCE(e.full_name,'Unknown') || ' ' || TO_CHAR(pr.salary_month,'Mon YYYY')
FROM payroll_runs pr
JOIN employees e ON e.id = pr.employee_id
WHERE NOT EXISTS (
  SELECT 1 FROM ledger_entries le
  WHERE le.source_table = 'payroll_runs' AND le.source_id = pr.id AND le.account_code = 'EXP_SALARY'
);

INSERT INTO ledger_entries (tenant_id, account_code, entry_date, debit, credit, source_table, source_id, description)
SELECT
  pr.tenant_id, 'CASH', pr.created_at::date, 0, pr.net_payable,
  'payroll_runs', pr.id,
  'Salary paid ' || COALESCE(e.full_name,'Unknown') || ' ' || TO_CHAR(pr.salary_month,'Mon YYYY')
FROM payroll_runs pr
JOIN employees e ON e.id = pr.employee_id
WHERE NOT EXISTS (
  SELECT 1 FROM ledger_entries le
  WHERE le.source_table = 'payroll_runs' AND le.source_id = pr.id AND le.account_code = 'CASH'
);


-- ============================================================================
-- GAP-2: INVOICE DELIVERY → ledger_entries
--   Existing trigger move_stock_on_delivery writes to agency_ledger.
--   This patch also writes to ledger_entries for delivered invoices.
-- ============================================================================

CREATE OR REPLACE FUNCTION move_stock_on_delivery()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $fn$
DECLARE
  v_product TEXT;
  v_parts   TEXT[];
  v_name    TEXT;
  v_qty     NUMERIC(12,2);
  v_pid     UUID;
BEGIN
  IF NEW.delivery_status <> 'delivered' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.delivery_status = 'delivered' THEN RETURN NEW; END IF;

  FOR v_product IN
    SELECT BTRIM(p) FROM UNNEST(string_to_array(NEW.products, ',')) AS p
  LOOP
    IF POSITION(chr(215) IN v_product) > 0 THEN
      v_parts := string_to_array(v_product, chr(215));
      v_name  := BTRIM(v_parts[1]);
      v_qty   := BTRIM(v_parts[2])::NUMERIC;
    ELSIF v_product ~* ' x [0-9]+$' THEN
      v_parts := regexp_split_to_array(v_product, ' [xX] ');
      v_name  := BTRIM(v_parts[1]);
      v_qty   := BTRIM(v_parts[2])::NUMERIC;
    ELSE
      v_name := BTRIM(v_product);
      v_qty  := 1;
    END IF;

    UPDATE warehouse_stock
    SET qty_total = GREATEST(qty_total - v_qty, 0)
    WHERE tenant_id = NEW.tenant_id AND product_name = v_name;

    v_pid := get_or_create_product_id(NEW.tenant_id, v_name);

    INSERT INTO stock_movements (tenant_id, product_id, movement_date, direction, quantity, amount, source_table, source_id)
    VALUES (NEW.tenant_id, v_pid, COALESCE(NEW.invoice_date, CURRENT_DATE), 'out', v_qty,
            COALESCE(NEW.grand_total, 0), 'invoices', NEW.id);
  END LOOP;

  INSERT INTO agency_ledger (tenant_id, entry_date, description, amount, entry_type, ref_table, ref_id)
  VALUES (
    NEW.tenant_id, COALESCE(NEW.invoice_date, CURRENT_DATE),
    'Invoice ' || NEW.invoice_no || ' delivered',
    COALESCE(NEW.grand_total, 0), 'sale', 'invoices', NEW.id
  )
  ON CONFLICT DO NOTHING;

  INSERT INTO ledger_entries (tenant_id, account_code, entry_date, debit, credit, source_table, source_id, description)
  VALUES
    (NEW.tenant_id,
     CASE WHEN NEW.invoice_type = 'cash' THEN 'CASH' ELSE 'AR_CREDIT' END,
     COALESCE(NEW.invoice_date, CURRENT_DATE),
     COALESCE(NEW.grand_total, 0), 0,
     'invoices', NEW.id,
     'Sale invoice ' || NEW.invoice_no),
    (NEW.tenant_id, 'REV_SALES',
     COALESCE(NEW.invoice_date, CURRENT_DATE),
     0, COALESCE(NEW.grand_total, 0),
     'invoices', NEW.id,
     'Sale revenue ' || NEW.invoice_no),
    (NEW.tenant_id, 'STOCK',
     COALESCE(NEW.invoice_date, CURRENT_DATE),
     0, COALESCE(NEW.grand_total, 0),
     'invoices', NEW.id,
     'Stock out invoice ' || NEW.invoice_no);

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_move_stock_on_delivery ON invoices;
CREATE TRIGGER trg_move_stock_on_delivery
  AFTER INSERT OR UPDATE OF delivery_status ON invoices
  FOR EACH ROW EXECUTE FUNCTION move_stock_on_delivery();

-- Backfill delivered invoices into ledger_entries (safe guard)
INSERT INTO ledger_entries (tenant_id, account_code, entry_date, debit, credit, source_table, source_id, description)
SELECT
  i.tenant_id,
  CASE WHEN i.invoice_type = 'cash' THEN 'CASH' ELSE 'AR_CREDIT' END,
  COALESCE(i.invoice_date::date, i.created_at::date),
  COALESCE(i.grand_total, 0), 0,
  'invoices', i.id,
  'Sale invoice ' || i.invoice_no
FROM invoices i
WHERE i.delivery_status = 'delivered'
  AND NOT EXISTS (
    SELECT 1 FROM ledger_entries le
    WHERE le.source_table = 'invoices' AND le.source_id = i.id
      AND le.account_code IN ('CASH','AR_CREDIT')
  );

INSERT INTO ledger_entries (tenant_id, account_code, entry_date, debit, credit, source_table, source_id, description)
SELECT
  i.tenant_id, 'REV_SALES',
  COALESCE(i.invoice_date::date, i.created_at::date),
  0, COALESCE(i.grand_total, 0),
  'invoices', i.id,
  'Sale revenue ' || i.invoice_no
FROM invoices i
WHERE i.delivery_status = 'delivered'
  AND NOT EXISTS (
    SELECT 1 FROM ledger_entries le
    WHERE le.source_table = 'invoices' AND le.source_id = i.id
      AND le.account_code = 'REV_SALES'
  );


-- ============================================================================
-- GAP-3: invoice_line_items.unit_rate — use actual products.sale_rate
--   Rewrites sync_invoice_line_items to join products table for real rate.
--   Falls back to proportional estimate only when product has no sale_rate.
-- ============================================================================

CREATE OR REPLACE FUNCTION sync_invoice_line_items()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $fn$
DECLARE
  v_product TEXT;
  v_parts   TEXT[];
  v_name    TEXT;
  v_qty     NUMERIC(12,2);
  v_pid     UUID;
  v_rate    NUMERIC(12,2);
  v_total_parsed_qty NUMERIC(12,2) := 0;
  v_grand_total      NUMERIC(14,2);
BEGIN
  DELETE FROM invoice_line_items WHERE invoice_id = NEW.id;

  FOR v_product IN
    SELECT BTRIM(p) FROM UNNEST(string_to_array(NEW.products, ',')) AS p
  LOOP
    IF POSITION(chr(215) IN v_product) > 0 THEN
      v_parts := string_to_array(v_product, chr(215));
      v_total_parsed_qty := v_total_parsed_qty + BTRIM(v_parts[2])::NUMERIC;
    ELSIF v_product ~* ' x [0-9]+$' THEN
      v_parts := regexp_split_to_array(v_product, ' [xX] ');
      v_total_parsed_qty := v_total_parsed_qty + BTRIM(v_parts[2])::NUMERIC;
    ELSE
      v_total_parsed_qty := v_total_parsed_qty + 1;
    END IF;
  END LOOP;

  v_grand_total :=
    COALESCE(NEW.grand_total,
      NEW.invoice_total - COALESCE(NEW.discount_amount, 0) + COALESCE(NEW.advance_tax, 0),
      0);

  FOR v_product IN
    SELECT BTRIM(p) FROM UNNEST(string_to_array(NEW.products, ',')) AS p
  LOOP
    IF POSITION(chr(215) IN v_product) > 0 THEN
      v_parts := string_to_array(v_product, chr(215));
      v_name  := BTRIM(v_parts[1]);
      v_qty   := BTRIM(v_parts[2])::NUMERIC;
    ELSIF v_product ~* ' x [0-9]+$' THEN
      v_parts := regexp_split_to_array(v_product, ' [xX] ');
      v_name  := BTRIM(v_parts[1]);
      v_qty   := BTRIM(v_parts[2])::NUMERIC;
    ELSE
      v_name := BTRIM(v_product);
      v_qty  := 1;
    END IF;

    v_pid := get_or_create_product_id(NEW.tenant_id, v_name);

    SELECT COALESCE(sale_rate, 0) INTO v_rate
    FROM products
    WHERE id = v_pid AND tenant_id = NEW.tenant_id;

    IF v_rate IS NULL OR v_rate = 0 THEN
      v_rate := CASE WHEN v_total_parsed_qty > 0
                     THEN ROUND(v_grand_total / NULLIF(v_total_parsed_qty, 0), 2)
                     ELSE 0 END;
    END IF;

    INSERT INTO invoice_line_items (
      tenant_id, invoice_id, product_id, quantity, unit_rate, line_amount
    ) VALUES (
      NEW.tenant_id,
      NEW.id,
      v_pid,
      v_qty,
      v_rate,
      ROUND(v_rate * v_qty, 2)
    );
  END LOOP;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_sync_invoice_line_items ON invoices;
CREATE TRIGGER trg_sync_invoice_line_items
  AFTER INSERT OR UPDATE OF products ON invoices
  FOR EACH ROW EXECUTE FUNCTION sync_invoice_line_items();

UPDATE invoices SET products = products WHERE products IS NOT NULL;

-- ============================================================================
-- GAP-3b: invoice_returns table
--   Stores per-product returned qty per invoice.
-- ============================================================================

CREATE TABLE IF NOT EXISTS invoice_returns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL DEFAULT current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id      UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_name    TEXT NOT NULL,
  returned_qty    INTEGER NOT NULL DEFAULT 0 CHECK (returned_qty >= 0),
  return_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_invoice_returns UNIQUE (tenant_id, invoice_id, product_name)
);
CREATE INDEX IF NOT EXISTS idx_invoice_returns_invoice ON invoice_returns(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_returns_tenant  ON invoice_returns(tenant_id);
ALTER TABLE invoice_returns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invoice_returns_owner_all ON invoice_returns;
CREATE POLICY invoice_returns_owner_all ON invoice_returns FOR ALL
  TO authenticated
  USING  (tenant_id = (SELECT current_tenant_id()) AND (SELECT is_tenant_enabled()))
  WITH CHECK (tenant_id = (SELECT current_tenant_id()) AND (SELECT is_tenant_enabled()));

-- ============================================================================
-- END OF GAP FIXES
-- ============================================================================
