-- ============================================================================
-- MDOS v9.1 UPDATES — Product Catalogue · Financial Reports · Warehouse Heads
--
-- Run AFTER mdos_v9.1_consolidated.sql (which must have run first).
-- Safe to re-run (IF EXISTS / OR REPLACE / IF NOT EXISTS / ON CONFLICT).
--
-- What this file adds:
--   A. product_categories    — Catalogue Heads (is_returnable, is_rgb)
--   B. products extensions   — category_id, product_code, sale_rate,
--                              purchase_rate, packing_qty
--   C. sell_in_arrived_lines — per-PO-line arrived/returned qty confirmation
--   D. advance_tax_report    — new Financial Report view
--   E. discount_report       — new Financial Report view
--   F. warehouse_* views     — dynamic heads for Warehouse page
--   G. Realtime + Feature flag
-- ============================================================================

-- ============================================================================
-- A. PRODUCT CATEGORIES (Heads)
-- ============================================================================

CREATE TABLE IF NOT EXISTS product_categories (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID         NOT NULL DEFAULT current_tenant_id()
                               REFERENCES tenants(id) ON DELETE CASCADE,
  title         TEXT         NOT NULL,
  is_returnable BOOLEAN      NOT NULL DEFAULT FALSE,
  is_rgb        BOOLEAN      NOT NULL DEFAULT FALSE,
  active        BOOLEAN      NOT NULL DEFAULT TRUE,
  sort_order    INTEGER      NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT uq_product_categories_tenant_title UNIQUE (tenant_id, title),
  CONSTRAINT chk_product_categories_rgb
    CHECK (is_rgb = FALSE OR is_returnable = TRUE)
);

CREATE INDEX IF NOT EXISTS idx_product_categories_tenant
  ON product_categories(tenant_id, sort_order);

DROP TRIGGER IF EXISTS trg_product_categories_updated_at ON product_categories;
CREATE TRIGGER trg_product_categories_updated_at
  BEFORE UPDATE ON product_categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE product_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS product_categories_owner_all ON product_categories;
CREATE POLICY product_categories_owner_all ON product_categories FOR ALL
  TO authenticated
  USING  (tenant_id = (SELECT current_tenant_id()) AND (SELECT is_tenant_enabled()))
  WITH CHECK (tenant_id = (SELECT current_tenant_id()) AND (SELECT is_tenant_enabled()));

-- ============================================================================
-- B. EXTEND PRODUCTS TABLE
-- ============================================================================

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS category_id    UUID REFERENCES product_categories(id) ON DELETE SET NULL;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS product_code   TEXT;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS sale_rate      NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS purchase_rate  NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS packing_qty    NUMERIC(10,2) NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_products_tenant_code
  ON products(tenant_id, product_code)
  WHERE product_code IS NOT NULL;

-- ============================================================================
-- C. SELL_IN_ARRIVED_LINES
--    Records actual arrived qty and returned-to-driver qty per sell_in_line
--    when a PO is marked Stock Arrived (replaces the one-click stock_arrived).
-- ============================================================================

CREATE TABLE IF NOT EXISTS sell_in_arrived_lines (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID          NOT NULL DEFAULT current_tenant_id()
                                   REFERENCES tenants(id) ON DELETE CASCADE,
  sell_in_order_id UUID          NOT NULL REFERENCES sell_in_orders(id) ON DELETE CASCADE,
  sell_in_line_id  UUID          NOT NULL REFERENCES sell_in_lines(id)  ON DELETE CASCADE,
  arrived_qty      NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (arrived_qty  >= 0),
  returned_qty     NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (returned_qty >= 0),
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT uq_sell_in_arrived_line UNIQUE (sell_in_line_id)
);

CREATE INDEX IF NOT EXISTS idx_sell_in_arrived_lines_order
  ON sell_in_arrived_lines(sell_in_order_id);
CREATE INDEX IF NOT EXISTS idx_sell_in_arrived_lines_tenant
  ON sell_in_arrived_lines(tenant_id);

ALTER TABLE sell_in_arrived_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sell_in_arrived_lines_owner_all ON sell_in_arrived_lines;
CREATE POLICY sell_in_arrived_lines_owner_all ON sell_in_arrived_lines FOR ALL
  TO authenticated
  USING  (tenant_id = (SELECT current_tenant_id()) AND (SELECT is_tenant_enabled()))
  WITH CHECK (tenant_id = (SELECT current_tenant_id()) AND (SELECT is_tenant_enabled()));

-- ============================================================================
-- D. ADVANCE TAX REPORT VIEW
--
-- Per sale date:
--   sale            = SUM(grand_total) for all invoices on that date
--   cash_collection = cash: grand_total | credit: amount_received AS OF NOW
--                     (attributed back to the original sale date)
--   tax_collected   = SUM(advance_tax) — unconditional, no payment gate
-- ============================================================================

CREATE OR REPLACE VIEW advance_tax_report WITH (security_invoker = TRUE) AS
SELECT
  tenant_id,
  invoice_date                                           AS date,
  SUM(COALESCE(grand_total, 0))                          AS sale,
  SUM(
    CASE
      WHEN invoice_type = 'cash'   THEN COALESCE(grand_total,    0)
      WHEN invoice_type = 'credit' THEN COALESCE(amount_received, 0)
      ELSE 0
    END
  )                                                      AS cash_collection,
  SUM(COALESCE(advance_tax, 0))                          AS tax_collected
FROM invoices
GROUP BY tenant_id, invoice_date;

-- ============================================================================
-- E. DISCOUNT REPORT VIEW
--
-- Per sale date:
--   sale            = SUM(grand_total)
--   cash_collection = same logic as advance_tax_report
--   discount_given  = SUM(discount_amount) — unconditional
-- ============================================================================

CREATE OR REPLACE VIEW discount_report WITH (security_invoker = TRUE) AS
SELECT
  tenant_id,
  invoice_date                                           AS date,
  SUM(COALESCE(grand_total, 0))                          AS sale,
  SUM(
    CASE
      WHEN invoice_type = 'cash'   THEN COALESCE(grand_total,    0)
      WHEN invoice_type = 'credit' THEN COALESCE(amount_received, 0)
      ELSE 0
    END
  )                                                      AS cash_collection,
  SUM(COALESCE(discount_amount, 0))                      AS discount_given
FROM invoices
GROUP BY tenant_id, invoice_date;

-- ============================================================================
-- F. WAREHOUSE VIEWS — Dynamic Heads
--
-- Routing per product_categories flags:
--   is_returnable = FALSE                 => own named head per category
--   is_returnable = TRUE, is_rgb = TRUE   => RGB head
--   is_returnable = TRUE, is_rgb = FALSE  => Empties head
-- ============================================================================

-- F1. Standard (non-returnable) heads — one row per product
--     Total Qty = arrived purchase lines - ccbpl returns at delivery - adjusted damage
--     Flappy    = unadjusted damaged_stock qty

CREATE OR REPLACE VIEW warehouse_standard_levels WITH (security_invoker = TRUE) AS
SELECT
  pc.tenant_id,
  pc.id                AS category_id,
  pc.title             AS category_title,
  p.id                 AS product_id,
  COALESCE(p.product_code, p.product_name) AS code,
  p.product_name,
  GREATEST(0,
    COALESCE((
      SELECT SUM(
        CASE
          WHEN sil.invoice_type = 'purchase' THEN  sal.arrived_qty
          WHEN sil.invoice_type = 'return'   THEN -sal.arrived_qty
          ELSE 0
        END
      )
      FROM sell_in_arrived_lines sal
      JOIN sell_in_lines  sil ON sil.id = sal.sell_in_line_id
      JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id
      WHERE sil.product_id = p.id
        AND sio.tenant_id  = pc.tenant_id
        AND sio.status     IN ('stock_arrived','on_credit','billed')
    ), 0)
    - COALESCE((
      SELECT SUM(ds.quantity) FROM damaged_stock ds
      WHERE ds.tenant_id    = pc.tenant_id
        AND ds.product_name = p.product_name
        AND ds.status       = 'adjusted'
    ), 0)
  )                    AS total_qty,
  COALESCE((
    SELECT SUM(ds.quantity) FROM damaged_stock ds
    WHERE ds.tenant_id    = pc.tenant_id
      AND ds.product_name = p.product_name
      AND ds.status       <> 'adjusted'
  ), 0)                AS flappy
FROM product_categories pc
JOIN products p ON p.category_id = pc.id
WHERE pc.is_returnable = FALSE
  AND p.active = TRUE;

-- F2. RGB head (is_returnable=TRUE, is_rgb=TRUE)
--     Available = Total Qty - Returned - Unreturned

CREATE OR REPLACE VIEW warehouse_rgb_levels WITH (security_invoker = TRUE) AS
SELECT
  pc.tenant_id,
  p.id                 AS product_id,
  COALESCE(p.product_code, p.product_name) AS code,
  p.product_name,
  GREATEST(0, COALESCE((
    SELECT SUM(
      CASE
        WHEN sil.invoice_type = 'purchase'
          THEN sal.arrived_qty - COALESCE(sal.returned_qty, 0)
        WHEN sil.invoice_type = 'return'
          THEN -sal.arrived_qty
        ELSE 0
      END
    )
    FROM sell_in_arrived_lines sal
    JOIN sell_in_lines  sil ON sil.id = sal.sell_in_line_id
    JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id
    WHERE sil.product_id = p.id
      AND sio.tenant_id  = pc.tenant_id
      AND sio.status     IN ('stock_arrived','on_credit','billed')
  ), 0))               AS total_qty,
  COALESCE((
    SELECT SUM(rw.received_qty) FROM returns_wayback rw
    WHERE rw.tenant_id    = pc.tenant_id
      AND rw.product_name = p.product_name
      AND rw.status       = 'approved'
  ), 0)                AS returned,
  GREATEST(0,
    COALESCE((
      SELECT SUM(ili.quantity) FROM invoice_line_items ili
      JOIN invoices inv ON inv.id = ili.invoice_id
      WHERE ili.tenant_id  = pc.tenant_id
        AND ili.product_id = p.id
        AND inv.delivery_status = 'delivered'
    ), 0)
    - COALESCE((
      SELECT SUM(rw.received_qty) FROM returns_wayback rw
      WHERE rw.tenant_id    = pc.tenant_id
        AND rw.product_name = p.product_name
        AND rw.status       = 'approved'
    ), 0)
  )                    AS unreturned,
  GREATEST(0,
    COALESCE((
      SELECT SUM(
        CASE
          WHEN sil.invoice_type = 'purchase'
            THEN sal.arrived_qty - COALESCE(sal.returned_qty, 0)
          WHEN sil.invoice_type = 'return'
            THEN -sal.arrived_qty
          ELSE 0
        END
      )
      FROM sell_in_arrived_lines sal
      JOIN sell_in_lines  sil ON sil.id = sal.sell_in_line_id
      JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id
      WHERE sil.product_id = p.id
        AND sio.tenant_id  = pc.tenant_id
        AND sio.status     IN ('stock_arrived','on_credit','billed')
    ), 0)
    - COALESCE((
      SELECT SUM(rw.received_qty) FROM returns_wayback rw
      WHERE rw.tenant_id    = pc.tenant_id
        AND rw.product_name = p.product_name
        AND rw.status       = 'approved'
    ), 0)
    - GREATEST(0,
        COALESCE((
          SELECT SUM(ili.quantity) FROM invoice_line_items ili
          JOIN invoices inv ON inv.id = ili.invoice_id
          WHERE ili.tenant_id  = pc.tenant_id
            AND ili.product_id = p.id
            AND inv.delivery_status = 'delivered'
        ), 0)
        - COALESCE((
          SELECT SUM(rw.received_qty) FROM returns_wayback rw
          WHERE rw.tenant_id    = pc.tenant_id
            AND rw.product_name = p.product_name
            AND rw.status       = 'approved'
        ), 0)
      )
  )                    AS available
FROM product_categories pc
JOIN products p ON p.category_id = pc.id
WHERE pc.is_returnable = TRUE
  AND pc.is_rgb = TRUE
  AND p.active = TRUE;

-- F3. Empties head (is_returnable=TRUE, is_rgb=FALSE)
--     Available = Total Qty - Unreturned  (Returned folds into Available)

CREATE OR REPLACE VIEW warehouse_empties_levels WITH (security_invoker = TRUE) AS
SELECT
  pc.tenant_id,
  p.id                 AS product_id,
  COALESCE(p.product_code, p.product_name) AS code,
  p.product_name,
  GREATEST(0, COALESCE((
    SELECT SUM(
      CASE
        WHEN sil.invoice_type = 'purchase'
          THEN sal.arrived_qty - COALESCE(sal.returned_qty, 0)
        WHEN sil.invoice_type = 'return'
          THEN -sal.arrived_qty
        ELSE 0
      END
    )
    FROM sell_in_arrived_lines sal
    JOIN sell_in_lines  sil ON sil.id = sal.sell_in_line_id
    JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id
    WHERE sil.product_id = p.id
      AND sio.tenant_id  = pc.tenant_id
      AND sio.status     IN ('stock_arrived','on_credit','billed')
  ), 0))               AS total_qty,
  COALESCE((
    SELECT SUM(rw.received_qty) FROM returns_wayback rw
    WHERE rw.tenant_id    = pc.tenant_id
      AND rw.product_name = p.product_name
      AND rw.status       = 'approved'
  ), 0)                AS returned,
  GREATEST(0,
    COALESCE((
      SELECT SUM(ili.quantity) FROM invoice_line_items ili
      JOIN invoices inv ON inv.id = ili.invoice_id
      WHERE ili.tenant_id  = pc.tenant_id
        AND ili.product_id = p.id
        AND inv.delivery_status = 'delivered'
    ), 0)
    - COALESCE((
      SELECT SUM(rw.received_qty) FROM returns_wayback rw
      WHERE rw.tenant_id    = pc.tenant_id
        AND rw.product_name = p.product_name
        AND rw.status       = 'approved'
    ), 0)
  )                    AS unreturned,
  -- Available = Total Qty - Unreturned
  GREATEST(0,
    COALESCE((
      SELECT SUM(
        CASE
          WHEN sil.invoice_type = 'purchase'
            THEN sal.arrived_qty - COALESCE(sal.returned_qty, 0)
          WHEN sil.invoice_type = 'return'
            THEN -sal.arrived_qty
          ELSE 0
        END
      )
      FROM sell_in_arrived_lines sal
      JOIN sell_in_lines  sil ON sil.id = sal.sell_in_line_id
      JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id
      WHERE sil.product_id = p.id
        AND sio.tenant_id  = pc.tenant_id
        AND sio.status     IN ('stock_arrived','on_credit','billed')
    ), 0)
    - GREATEST(0,
        COALESCE((
          SELECT SUM(ili.quantity) FROM invoice_line_items ili
          JOIN invoices inv ON inv.id = ili.invoice_id
          WHERE ili.tenant_id  = pc.tenant_id
            AND ili.product_id = p.id
            AND inv.delivery_status = 'delivered'
        ), 0)
        - COALESCE((
          SELECT SUM(rw.received_qty) FROM returns_wayback rw
          WHERE rw.tenant_id    = pc.tenant_id
            AND rw.product_name = p.product_name
            AND rw.status       = 'approved'
        ), 0)
      )
  )                    AS available
FROM product_categories pc
JOIN products p ON p.category_id = pc.id
WHERE pc.is_returnable = TRUE
  AND pc.is_rgb = FALSE
  AND p.active = TRUE;

-- ============================================================================
-- G. REALTIME + FEATURE FLAG
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'product_categories'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE product_categories;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'sell_in_arrived_lines'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE sell_in_arrived_lines;
  END IF;
END $$;

INSERT INTO global_feature_flags (flag_key, label, enabled)
VALUES ('tab_product_catalogue', 'Product Catalogue with Heads (Categories)', TRUE)
ON CONFLICT (flag_key) DO UPDATE SET label = EXCLUDED.label;

-- ============================================================================
-- END OF MDOS v9.1 UPDATES
-- ============================================================================

