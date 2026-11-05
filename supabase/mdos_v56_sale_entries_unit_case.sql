-- ============================================================================
-- MDOS v56 — Sale Entries, Set UN Case, Ph.Case/Unit Case, Stock Report
-- ============================================================================

-- 1. set_un_case on product_categories
ALTER TABLE product_categories
  ADD COLUMN IF NOT EXISTS set_un_case NUMERIC(10,2) NOT NULL DEFAULT 1;

-- 2. sale_entries (header)
CREATE TABLE IF NOT EXISTS sale_entries (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL DEFAULT current_tenant_id() REFERENCES tenants(id),
  sale_no       TEXT        NOT NULL,
  sale_date     DATE        NOT NULL DEFAULT current_date,
  total_amount  NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sale_entries_no_tenant_unique UNIQUE(tenant_id, sale_no)
);

ALTER TABLE sale_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sale_entries_owner_all ON sale_entries;
CREATE POLICY sale_entries_owner_all ON sale_entries
  USING  (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- 3. sale_entry_lines (per-product lines)
CREATE TABLE IF NOT EXISTS sale_entry_lines (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID        NOT NULL DEFAULT current_tenant_id() REFERENCES tenants(id),
  sale_entry_id  UUID        NOT NULL REFERENCES sale_entries(id) ON DELETE CASCADE,
  product_id     UUID        NOT NULL REFERENCES products(id),
  sale_rate      NUMERIC(12,2) NOT NULL DEFAULT 0,
  qty            NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount         NUMERIC(14,2) GENERATED ALWAYS AS (sale_rate * qty) STORED,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE sale_entry_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sale_entry_lines_owner_all ON sale_entry_lines;
CREATE POLICY sale_entry_lines_owner_all ON sale_entry_lines
  USING  (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- 4. stock_report_entries (manual warehouse top-ups via Add Stock Report)
CREATE TABLE IF NOT EXISTS stock_report_entries (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID        NOT NULL DEFAULT current_tenant_id() REFERENCES tenants(id),
  report_date  DATE        NOT NULL DEFAULT current_date,
  product_id   UUID        NOT NULL REFERENCES products(id),
  ph_case      NUMERIC(12,2) NOT NULL DEFAULT 0,
  unit_case    NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE stock_report_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stock_report_entries_owner_all ON stock_report_entries;
CREATE POLICY stock_report_entries_owner_all ON stock_report_entries
  USING  (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- 5. Indexes
CREATE INDEX IF NOT EXISTS idx_sale_entries_tenant     ON sale_entries(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sale_entries_date       ON sale_entries(tenant_id, sale_date);
CREATE INDEX IF NOT EXISTS idx_sale_entry_lines_entry  ON sale_entry_lines(sale_entry_id);
CREATE INDEX IF NOT EXISTS idx_sale_entry_lines_prod   ON sale_entry_lines(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_report_entries_t  ON stock_report_entries(tenant_id);
CREATE INDEX IF NOT EXISTS idx_stock_report_entries_p  ON stock_report_entries(product_id);

-- ============================================================================
-- 6. Rebuild warehouse_standard_levels with Ph.Case / Unit Case + sale deductions
-- ============================================================================
DROP VIEW IF EXISTS warehouse_rgb_levels     CASCADE;
DROP VIEW IF EXISTS warehouse_empties_levels CASCADE;
DROP VIEW IF EXISTS warehouse_standard_levels CASCADE;

CREATE VIEW warehouse_standard_levels WITH (security_invoker = TRUE) AS
SELECT
  pc.tenant_id,
  pc.id                                    AS category_id,
  pc.title                                 AS category_title,
  pc.set_un_case,
  p.id                                     AS product_id,
  COALESCE(p.product_code, p.product_name) AS code,
  p.product_name,
  GREATEST(0,
    COALESCE((
      SELECT SUM(
        CASE
          WHEN sil.invoice_type = 'purchase'
            THEN COALESCE(sal.arrived_qty, sil.qty) - COALESCE(sal.returned_qty, 0)
          WHEN sil.invoice_type = 'return'
            THEN -COALESCE(sal.arrived_qty, sil.qty)
          ELSE 0
        END
      )
      FROM sell_in_lines sil
      JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id
      LEFT JOIN sell_in_arrived_lines sal ON sal.sell_in_line_id = sil.id
      JOIN products sil_p ON sil_p.id = sil.product_id
      WHERE sio.tenant_id = pc.tenant_id
        AND LOWER(TRIM(sil_p.product_name)) = LOWER(TRIM(p.product_name))
        AND sio.status IN ('stock_arrived','on_credit','billed')
    ), 0)
    + COALESCE((
      SELECT SUM(sre.ph_case)
      FROM stock_report_entries sre
      WHERE sre.tenant_id  = pc.tenant_id
        AND sre.product_id = p.id
    ), 0)
    - COALESCE((
      SELECT SUM(sel.qty)
      FROM sale_entry_lines sel
      JOIN sale_entries se ON se.id = sel.sale_entry_id
      WHERE se.tenant_id  = pc.tenant_id
        AND sel.product_id = p.id
    ), 0)
    - COALESCE((
      SELECT SUM(ds.quantity) FROM damaged_stock ds
      WHERE ds.tenant_id = pc.tenant_id
        AND LOWER(TRIM(ds.product_name)) = LOWER(TRIM(p.product_name))
    ), 0)
  )                                        AS total_qty,
  GREATEST(0,
    COALESCE((
      SELECT SUM(
        CASE
          WHEN sil.invoice_type = 'purchase'
            THEN COALESCE(sal.arrived_qty, sil.qty) - COALESCE(sal.returned_qty, 0)
          WHEN sil.invoice_type = 'return'
            THEN -COALESCE(sal.arrived_qty, sil.qty)
          ELSE 0
        END
      )
      FROM sell_in_lines sil
      JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id
      LEFT JOIN sell_in_arrived_lines sal ON sal.sell_in_line_id = sil.id
      JOIN products sil_p ON sil_p.id = sil.product_id
      WHERE sio.tenant_id = pc.tenant_id
        AND LOWER(TRIM(sil_p.product_name)) = LOWER(TRIM(p.product_name))
        AND sio.status IN ('stock_arrived','on_credit','billed')
    ), 0)
    + COALESCE((
      SELECT SUM(sre.ph_case)
      FROM stock_report_entries sre
      WHERE sre.tenant_id  = pc.tenant_id
        AND sre.product_id = p.id
    ), 0)
    - COALESCE((
      SELECT SUM(sel.qty)
      FROM sale_entry_lines sel
      JOIN sale_entries se ON se.id = sel.sale_entry_id
      WHERE se.tenant_id  = pc.tenant_id
        AND sel.product_id = p.id
    ), 0)
    - COALESCE((
      SELECT SUM(ds.quantity) FROM damaged_stock ds
      WHERE ds.tenant_id = pc.tenant_id
        AND LOWER(TRIM(ds.product_name)) = LOWER(TRIM(p.product_name))
    ), 0)
  )                                        AS ph_case,
  GREATEST(0,
    (
      COALESCE((
        SELECT SUM(
          CASE
            WHEN sil.invoice_type = 'purchase'
              THEN COALESCE(sal.arrived_qty, sil.qty) - COALESCE(sal.returned_qty, 0)
            WHEN sil.invoice_type = 'return'
              THEN -COALESCE(sal.arrived_qty, sil.qty)
            ELSE 0
          END
        )
        FROM sell_in_lines sil
        JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id
        LEFT JOIN sell_in_arrived_lines sal ON sal.sell_in_line_id = sil.id
        JOIN products sil_p ON sil_p.id = sil.product_id
        WHERE sio.tenant_id = pc.tenant_id
          AND LOWER(TRIM(sil_p.product_name)) = LOWER(TRIM(p.product_name))
          AND sio.status IN ('stock_arrived','on_credit','billed')
      ), 0)
      + COALESCE((
        SELECT SUM(sre.ph_case)
        FROM stock_report_entries sre
        WHERE sre.tenant_id  = pc.tenant_id
          AND sre.product_id = p.id
      ), 0)
      - COALESCE((
        SELECT SUM(sel.qty)
        FROM sale_entry_lines sel
        JOIN sale_entries se ON se.id = sel.sale_entry_id
        WHERE se.tenant_id  = pc.tenant_id
          AND sel.product_id = p.id
      ), 0)
      - COALESCE((
        SELECT SUM(ds.quantity) FROM damaged_stock ds
        WHERE ds.tenant_id = pc.tenant_id
          AND LOWER(TRIM(ds.product_name)) = LOWER(TRIM(p.product_name))
      ), 0)
    ) * pc.set_un_case
  )                                        AS unit_case,
  COALESCE((
    SELECT SUM(ds.quantity) FROM damaged_stock ds
    WHERE ds.tenant_id = pc.tenant_id
      AND LOWER(TRIM(ds.product_name)) = LOWER(TRIM(p.product_name))
      AND ds.status <> 'adjusted'
  ), 0)                                    AS flappy
FROM product_categories pc
JOIN products p ON p.category_id = pc.id
WHERE pc.is_returnable = FALSE
  AND p.active = TRUE;


CREATE VIEW warehouse_rgb_levels WITH (security_invoker = TRUE) AS
SELECT
  pc.tenant_id,
  pc.set_un_case,
  p.id                                     AS product_id,
  COALESCE(p.product_code, p.product_name) AS code,
  p.product_name,
  GREATEST(0, COALESCE((
    SELECT SUM(
      CASE
        WHEN sil.invoice_type = 'purchase'
          THEN COALESCE(sal.arrived_qty, sil.qty) - COALESCE(sal.returned_qty, 0)
        WHEN sil.invoice_type = 'return'
          THEN -COALESCE(sal.arrived_qty, sil.qty)
        ELSE 0
      END
    )
    FROM sell_in_lines sil
    JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id
    LEFT JOIN sell_in_arrived_lines sal ON sal.sell_in_line_id = sil.id
    JOIN products sil_p ON sil_p.id = sil.product_id
    WHERE sio.tenant_id = pc.tenant_id
      AND LOWER(TRIM(sil_p.product_name)) = LOWER(TRIM(p.product_name))
      AND sio.status IN ('stock_arrived','on_credit','billed')
  ), 0))                                   AS total_qty,
  GREATEST(0, COALESCE((
    SELECT SUM(
      CASE
        WHEN sil.invoice_type = 'purchase'
          THEN COALESCE(sal.arrived_qty, sil.qty) - COALESCE(sal.returned_qty, 0)
        WHEN sil.invoice_type = 'return'
          THEN -COALESCE(sal.arrived_qty, sil.qty)
        ELSE 0
      END
    )
    FROM sell_in_lines sil
    JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id
    LEFT JOIN sell_in_arrived_lines sal ON sal.sell_in_line_id = sil.id
    JOIN products sil_p ON sil_p.id = sil.product_id
    WHERE sio.tenant_id = pc.tenant_id
      AND LOWER(TRIM(sil_p.product_name)) = LOWER(TRIM(p.product_name))
      AND sio.status IN ('stock_arrived','on_credit','billed')
  ), 0))                                   AS ph_case,
  GREATEST(0, COALESCE((
    SELECT SUM(
      CASE
        WHEN sil.invoice_type = 'purchase'
          THEN COALESCE(sal.arrived_qty, sil.qty) - COALESCE(sal.returned_qty, 0)
        WHEN sil.invoice_type = 'return'
          THEN -COALESCE(sal.arrived_qty, sil.qty)
        ELSE 0
      END
    )
    FROM sell_in_lines sil
    JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id
    LEFT JOIN sell_in_arrived_lines sal ON sal.sell_in_line_id = sil.id
    JOIN products sil_p ON sil_p.id = sil.product_id
    WHERE sio.tenant_id = pc.tenant_id
      AND LOWER(TRIM(sil_p.product_name)) = LOWER(TRIM(p.product_name))
      AND sio.status IN ('stock_arrived','on_credit','billed')
  ), 0) * pc.set_un_case)                  AS unit_case,
  GREATEST(0, COALESCE((
    SELECT SUM(ir.returned_qty) FROM invoice_returns ir
    WHERE ir.tenant_id = pc.tenant_id
      AND LOWER(TRIM(ir.product_name)) = LOWER(TRIM(p.product_name))
  ), 0))                                   AS returned,
  GREATEST(0,
    COALESCE((
      SELECT SUM(ili.quantity) FROM invoice_line_items ili
      JOIN invoices inv ON inv.id = ili.invoice_id
      JOIN products ili_p ON ili_p.id = ili.product_id
      WHERE ili.tenant_id = pc.tenant_id
        AND LOWER(TRIM(ili_p.product_name)) = LOWER(TRIM(p.product_name))
        AND (inv.delivery_status IS NULL OR inv.delivery_status <> 'cancelled')
    ), 0)
    - COALESCE((
      SELECT SUM(ir.returned_qty) FROM invoice_returns ir
      WHERE ir.tenant_id = pc.tenant_id
        AND LOWER(TRIM(ir.product_name)) = LOWER(TRIM(p.product_name))
    ), 0)
  )                                        AS unreturned,
  GREATEST(0,
    COALESCE((
      SELECT SUM(
        CASE
          WHEN sil.invoice_type = 'purchase'
            THEN COALESCE(sal.arrived_qty, sil.qty) - COALESCE(sal.returned_qty, 0)
          WHEN sil.invoice_type = 'return'
            THEN -COALESCE(sal.arrived_qty, sil.qty)
          ELSE 0
        END
      )
      FROM sell_in_lines sil
      JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id
      LEFT JOIN sell_in_arrived_lines sal ON sal.sell_in_line_id = sil.id
      JOIN products sil_p ON sil_p.id = sil.product_id
      WHERE sio.tenant_id = pc.tenant_id
        AND LOWER(TRIM(sil_p.product_name)) = LOWER(TRIM(p.product_name))
        AND sio.status IN ('stock_arrived','on_credit','billed')
    ), 0)
    - (
        COALESCE((
          SELECT SUM(ili.quantity) FROM invoice_line_items ili
          JOIN invoices inv ON inv.id = ili.invoice_id
          JOIN products ili_p ON ili_p.id = ili.product_id
          WHERE ili.tenant_id = pc.tenant_id
            AND LOWER(TRIM(ili_p.product_name)) = LOWER(TRIM(p.product_name))
            AND (inv.delivery_status IS NULL OR inv.delivery_status <> 'cancelled')
        ), 0)
        - COALESCE((
          SELECT SUM(ir.returned_qty) FROM invoice_returns ir
          WHERE ir.tenant_id = pc.tenant_id
            AND LOWER(TRIM(ir.product_name)) = LOWER(TRIM(p.product_name))
        ), 0)
      )
    - COALESCE((
      SELECT SUM(ds.quantity) FROM damaged_stock ds
      WHERE ds.tenant_id = pc.tenant_id
        AND LOWER(TRIM(ds.product_name)) = LOWER(TRIM(p.product_name))
    ), 0)
  )                                        AS available
FROM product_categories pc
JOIN products p ON p.category_id = pc.id
WHERE pc.is_returnable = TRUE
  AND pc.is_rgb = TRUE
  AND p.active = TRUE;


CREATE VIEW warehouse_empties_levels WITH (security_invoker = TRUE) AS
SELECT
  pc.tenant_id,
  pc.set_un_case,
  p.id                                     AS product_id,
  COALESCE(p.product_code, p.product_name) AS code,
  p.product_name,
  GREATEST(0, COALESCE((
    SELECT SUM(
      CASE
        WHEN sil.invoice_type = 'purchase'
          THEN COALESCE(sal.arrived_qty, sil.qty) - COALESCE(sal.returned_qty, 0)
        WHEN sil.invoice_type = 'return'
          THEN -COALESCE(sal.arrived_qty, sil.qty)
        ELSE 0
      END
    )
    FROM sell_in_lines sil
    JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id
    LEFT JOIN sell_in_arrived_lines sal ON sal.sell_in_line_id = sil.id
    JOIN products sil_p ON sil_p.id = sil.product_id
    WHERE sio.tenant_id = pc.tenant_id
      AND LOWER(TRIM(sil_p.product_name)) = LOWER(TRIM(p.product_name))
      AND sio.status IN ('stock_arrived','on_credit','billed')
  ), 0))                                   AS total_qty,
  GREATEST(0, COALESCE((
    SELECT SUM(
      CASE
        WHEN sil.invoice_type = 'purchase'
          THEN COALESCE(sal.arrived_qty, sil.qty) - COALESCE(sal.returned_qty, 0)
        WHEN sil.invoice_type = 'return'
          THEN -COALESCE(sal.arrived_qty, sil.qty)
        ELSE 0
      END
    )
    FROM sell_in_lines sil
    JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id
    LEFT JOIN sell_in_arrived_lines sal ON sal.sell_in_line_id = sil.id
    JOIN products sil_p ON sil_p.id = sil.product_id
    WHERE sio.tenant_id = pc.tenant_id
      AND LOWER(TRIM(sil_p.product_name)) = LOWER(TRIM(p.product_name))
      AND sio.status IN ('stock_arrived','on_credit','billed')
  ), 0))                                   AS ph_case,
  GREATEST(0, COALESCE((
    SELECT SUM(
      CASE
        WHEN sil.invoice_type = 'purchase'
          THEN COALESCE(sal.arrived_qty, sil.qty) - COALESCE(sal.returned_qty, 0)
        WHEN sil.invoice_type = 'return'
          THEN -COALESCE(sal.arrived_qty, sil.qty)
        ELSE 0
      END
    )
    FROM sell_in_lines sil
    JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id
    LEFT JOIN sell_in_arrived_lines sal ON sal.sell_in_line_id = sil.id
    JOIN products sil_p ON sil_p.id = sil.product_id
    WHERE sio.tenant_id = pc.tenant_id
      AND LOWER(TRIM(sil_p.product_name)) = LOWER(TRIM(p.product_name))
      AND sio.status IN ('stock_arrived','on_credit','billed')
  ), 0) * pc.set_un_case)                  AS unit_case,
  GREATEST(0, COALESCE((
    SELECT SUM(ir.returned_qty) FROM invoice_returns ir
    WHERE ir.tenant_id = pc.tenant_id
      AND LOWER(TRIM(ir.product_name)) = LOWER(TRIM(p.product_name))
  ), 0))                                   AS returned,
  GREATEST(0,
    COALESCE((
      SELECT SUM(ili.quantity) FROM invoice_line_items ili
      JOIN invoices inv ON inv.id = ili.invoice_id
      JOIN products ili_p ON ili_p.id = ili.product_id
      WHERE ili.tenant_id = pc.tenant_id
        AND LOWER(TRIM(ili_p.product_name)) = LOWER(TRIM(p.product_name))
        AND (inv.delivery_status IS NULL OR inv.delivery_status <> 'cancelled')
    ), 0)
    - COALESCE((
      SELECT SUM(ir.returned_qty) FROM invoice_returns ir
      WHERE ir.tenant_id = pc.tenant_id
        AND LOWER(TRIM(ir.product_name)) = LOWER(TRIM(p.product_name))
    ), 0)
  )                                        AS unreturned,
  GREATEST(0,
    COALESCE((
      SELECT SUM(
        CASE
          WHEN sil.invoice_type = 'purchase'
            THEN COALESCE(sal.arrived_qty, sil.qty) - COALESCE(sal.returned_qty, 0)
          WHEN sil.invoice_type = 'return'
            THEN -COALESCE(sal.arrived_qty, sil.qty)
          ELSE 0
        END
      )
      FROM sell_in_lines sil
      JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id
      LEFT JOIN sell_in_arrived_lines sal ON sal.sell_in_line_id = sil.id
      JOIN products sil_p ON sil_p.id = sil.product_id
      WHERE sio.tenant_id = pc.tenant_id
        AND LOWER(TRIM(sil_p.product_name)) = LOWER(TRIM(p.product_name))
        AND sio.status IN ('stock_arrived','on_credit','billed')
    ), 0)
    - (
        COALESCE((
          SELECT SUM(ili.quantity) FROM invoice_line_items ili
          JOIN invoices inv ON inv.id = ili.invoice_id
          JOIN products ili_p ON ili_p.id = ili.product_id
          WHERE ili.tenant_id = pc.tenant_id
            AND LOWER(TRIM(ili_p.product_name)) = LOWER(TRIM(p.product_name))
            AND (inv.delivery_status IS NULL OR inv.delivery_status <> 'cancelled')
        ), 0)
        - COALESCE((
          SELECT SUM(ir.returned_qty) FROM invoice_returns ir
          WHERE ir.tenant_id = pc.tenant_id
            AND LOWER(TRIM(ir.product_name)) = LOWER(TRIM(p.product_name))
        ), 0)
      )
    - COALESCE((
      SELECT SUM(ds.quantity) FROM damaged_stock ds
      WHERE ds.tenant_id = pc.tenant_id
        AND LOWER(TRIM(ds.product_name)) = LOWER(TRIM(p.product_name))
    ), 0)
  )                                        AS available
FROM product_categories pc
JOIN products p ON p.category_id = pc.id
WHERE pc.is_returnable = TRUE
  AND (pc.is_rgb = FALSE OR pc.is_rgb IS NULL)
  AND p.active = TRUE;


-- ============================================================================
-- 7. Rebuild stock_ledger_view to include sale_entries as OUT
-- ============================================================================
DROP VIEW IF EXISTS stock_ledger_with_balance CASCADE;
DROP VIEW IF EXISTS stock_ledger_view          CASCADE;

CREATE OR REPLACE VIEW stock_ledger_view WITH (security_invoker = TRUE) AS

SELECT
  sio.tenant_id,
  sio.transaction_date                                              AS date,
  p.product_name,
  p.id                                                              AS product_id,
  'IN'::TEXT                                                        AS direction,
  'Sell In — ' || COALESCE(sio.po_no, 'PO-' || SUBSTRING(sio.id::TEXT, 1, 6)) AS source,
  'sell_in'::TEXT                                                   AS source_type,
  COALESCE(sio.po_no, '')                                           AS source_ref,
  COALESCE(sal.arrived_qty - COALESCE(sal.returned_qty, 0), sil.qty) AS qty,
  COALESCE(sal.id, sil.id)                                          AS event_id,
  COALESCE(sal.created_at, sil.created_at)                          AS event_ts
FROM sell_in_lines sil
JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id
JOIN products       p   ON p.id   = sil.product_id
LEFT JOIN sell_in_arrived_lines sal ON sal.sell_in_line_id = sil.id
WHERE sio.status IN ('stock_arrived', 'on_credit', 'billed')
  AND (sil.invoice_type IS NULL OR sil.invoice_type = 'purchase')
  AND COALESCE(sal.arrived_qty - COALESCE(sal.returned_qty, 0), sil.qty) > 0

UNION ALL

SELECT
  sre.tenant_id,
  sre.report_date                                                   AS date,
  p.product_name,
  p.id                                                              AS product_id,
  'IN'::TEXT                                                        AS direction,
  'Stock Report — ' || TO_CHAR(sre.report_date, 'YYYY-MM-DD')      AS source,
  'stock_report'::TEXT                                              AS source_type,
  ''::TEXT                                                          AS source_ref,
  sre.ph_case                                                       AS qty,
  sre.id                                                            AS event_id,
  sre.created_at                                                    AS event_ts
FROM stock_report_entries sre
JOIN products p ON p.id = sre.product_id
WHERE sre.ph_case > 0

UNION ALL

SELECT
  ili.tenant_id,
  inv.invoice_date                                                   AS date,
  MAX(p.product_name)                                                AS product_name,
  (MIN(p.id::TEXT))::UUID                                            AS product_id,
  'OUT'::TEXT                                                        AS direction,
  'Invoice — View'::TEXT                                             AS source,
  'invoice'::TEXT                                                    AS source_type,
  ''::TEXT                                                           AS source_ref,
  SUM(ili.quantity)                                                  AS qty,
  (MIN(ili.id::TEXT))::UUID                                          AS event_id,
  MIN(ili.created_at)                                                AS event_ts
FROM invoice_line_items ili
JOIN invoices inv ON inv.id = ili.invoice_id
JOIN products p   ON p.id  = ili.product_id
WHERE (inv.delivery_status IS NULL OR inv.delivery_status <> 'cancelled')
  AND ili.quantity > 0
GROUP BY ili.tenant_id, inv.invoice_date, LOWER(TRIM(p.product_name))

UNION ALL

SELECT
  se.tenant_id,
  se.sale_date                                                       AS date,
  MAX(p.product_name)                                                AS product_name,
  (MIN(p.id::TEXT))::UUID                                            AS product_id,
  'OUT'::TEXT                                                        AS direction,
  'Sales — View'::TEXT                                               AS source,
  'sale_entry'::TEXT                                                 AS source_type,
  se.sale_no                                                         AS source_ref,
  SUM(sel.qty)                                                       AS qty,
  (MIN(sel.id::TEXT))::UUID                                          AS event_id,
  MIN(sel.created_at)                                                AS event_ts
FROM sale_entry_lines sel
JOIN sale_entries se ON se.id = sel.sale_entry_id
JOIN products p       ON p.id = sel.product_id
WHERE sel.qty > 0
GROUP BY se.tenant_id, se.sale_date, se.sale_no, LOWER(TRIM(p.product_name))

UNION ALL

SELECT
  ds.tenant_id,
  ds.recorded_date                                                   AS date,
  COALESCE(p.product_name, ds.product_name)                         AS product_name,
  p.id                                                               AS product_id,
  'OUT'::TEXT                                                        AS direction,
  'Damaged Stock — ' || COALESCE(NULLIF(ds.webspace_ref, ''), 'DMG-' || UPPER(SUBSTRING(ds.id::TEXT, 1, 6))) AS source,
  'damaged_stock'::TEXT                                              AS source_type,
  COALESCE(ds.webspace_ref, '')                                      AS source_ref,
  ds.quantity                                                        AS qty,
  ds.id                                                              AS event_id,
  ds.created_at                                                      AS event_ts
FROM damaged_stock ds
LEFT JOIN (
  SELECT DISTINCT ON (tenant_id, LOWER(TRIM(product_name)))
    id, product_name, tenant_id
  FROM products
  ORDER BY tenant_id, LOWER(TRIM(product_name)), created_at DESC
) p ON p.tenant_id = ds.tenant_id
  AND LOWER(TRIM(p.product_name)) = LOWER(TRIM(ds.product_name))
WHERE ds.quantity > 0

UNION ALL

SELECT
  ir.tenant_id,
  ir.return_date                                                     AS date,
  COALESCE(MAX(p.product_name), MAX(ir.product_name))               AS product_name,
  (MIN(p.id::TEXT))::UUID                                            AS product_id,
  'IN'::TEXT                                                         AS direction,
  'Returns & Wayback — View'::TEXT                                   AS source,
  'returns'::TEXT                                                    AS source_type,
  ''::TEXT                                                           AS source_ref,
  SUM(ir.returned_qty)                                               AS qty,
  (MIN(ir.id::TEXT))::UUID                                           AS event_id,
  MIN(ir.created_at)                                                 AS event_ts
FROM invoice_returns ir
JOIN invoices inv ON inv.id = ir.invoice_id
LEFT JOIN (
  SELECT DISTINCT ON (tenant_id, LOWER(TRIM(product_name)))
    id, product_name, tenant_id
  FROM products
  ORDER BY tenant_id, LOWER(TRIM(product_name)), created_at DESC
) p ON p.tenant_id = ir.tenant_id
  AND LOWER(TRIM(p.product_name)) = LOWER(TRIM(ir.product_name))
WHERE ir.returned_qty > 0
GROUP BY ir.tenant_id, ir.return_date, LOWER(TRIM(ir.product_name));


CREATE OR REPLACE VIEW stock_ledger_with_balance WITH (security_invoker = TRUE) AS
SELECT
  tenant_id,
  date,
  product_name,
  product_id,
  direction,
  source,
  source_type,
  source_ref,
  qty,
  SUM(
    CASE WHEN direction = 'IN' THEN qty ELSE -qty END
  ) OVER (
    PARTITION BY tenant_id, LOWER(TRIM(product_name))
    ORDER BY date, event_ts, event_id
    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
  ) AS running_balance
FROM stock_ledger_view;


DROP FUNCTION IF EXISTS get_stock_ledger(UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION get_stock_ledger(
  p_product_id UUID,
  p_date_from  TEXT DEFAULT NULL,
  p_date_to    TEXT DEFAULT NULL
)
RETURNS TABLE (
  date            DATE,
  product_name    TEXT,
  direction       TEXT,
  source          TEXT,
  source_type     TEXT,
  source_ref      TEXT,
  qty             NUMERIC,
  running_balance NUMERIC
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_norm_name TEXT;
  v_tenant_id UUID;
BEGIN
  v_tenant_id := current_tenant_id();

  SELECT LOWER(TRIM(p.product_name)) INTO v_norm_name
  FROM products p
  WHERE p.id = p_product_id AND p.tenant_id = v_tenant_id;

  IF v_norm_name IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    slb.date,
    slb.product_name,
    slb.direction,
    slb.source,
    slb.source_type,
    slb.source_ref,
    slb.qty,
    slb.running_balance
  FROM stock_ledger_with_balance slb
  WHERE slb.tenant_id = v_tenant_id
    AND LOWER(TRIM(slb.product_name)) = v_norm_name
    AND (p_date_from IS NULL OR slb.date >= p_date_from::DATE)
    AND (p_date_to   IS NULL OR slb.date <= p_date_to::DATE)
  ORDER BY slb.date ASC, slb.running_balance ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_stock_ledger(UUID, TEXT, TEXT) TO authenticated;


-- ============================================================================
-- 8. Rebuild stock_balance_by_level to include sale_entry_lines as OUT
-- ============================================================================
DROP VIEW IF EXISTS stock_balance_by_level CASCADE;

CREATE OR REPLACE VIEW stock_balance_by_level WITH (security_invoker = TRUE) AS
SELECT
  tenant_id,
  product_name,
  packing_qty,
  SUM(CASE WHEN direction = 'IN'  THEN qty ELSE 0 END) AS total_qty_in,
  SUM(CASE WHEN direction = 'OUT' THEN qty ELSE 0 END) AS total_qty_out,
  SUM(CASE WHEN direction = 'IN'  THEN qty ELSE -qty END) AS net_balance
FROM stock_ledger_view slv
JOIN (
  SELECT id, packing_qty FROM products
) prod ON prod.id = slv.product_id
GROUP BY tenant_id, product_name, packing_qty;


DROP FUNCTION IF EXISTS get_stock_balance_filtered(TEXT, TEXT);

CREATE OR REPLACE FUNCTION get_stock_balance_filtered(
  p_date_from TEXT DEFAULT NULL,
  p_date_to   TEXT DEFAULT NULL
)
RETURNS TABLE (
  product_name  TEXT,
  packing_qty   NUMERIC,
  total_qty_in  NUMERIC,
  total_qty_out NUMERIC,
  net_balance   NUMERIC
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT
    slv.product_name,
    p.packing_qty,
    SUM(CASE WHEN slv.direction = 'IN'  THEN slv.qty ELSE 0    END),
    SUM(CASE WHEN slv.direction = 'OUT' THEN slv.qty ELSE 0    END),
    SUM(CASE WHEN slv.direction = 'IN'  THEN slv.qty ELSE -slv.qty END)
  FROM stock_ledger_view slv
  JOIN products p ON p.id = slv.product_id
  WHERE slv.tenant_id = current_tenant_id()
    AND (p_date_from IS NULL OR slv.date >= p_date_from::DATE)
    AND (p_date_to   IS NULL OR slv.date <= p_date_to::DATE)
  GROUP BY slv.product_name, p.packing_qty
  ORDER BY slv.product_name;
END;
$$;

GRANT EXECUTE ON FUNCTION get_stock_balance_filtered(TEXT, TEXT) TO authenticated;


-- ============================================================================
-- 9. Rebuild sale_purchase_summary to include sale_entry_lines
-- ============================================================================
DROP VIEW IF EXISTS sale_purchase_summary CASCADE;

CREATE OR REPLACE VIEW sale_purchase_summary WITH (security_invoker = TRUE) AS
SELECT
  p.tenant_id,
  p.product_name,
  COALESCE(pur.purchase_qty,    0)  AS purchase_qty,
  COALESCE(pur.purchase_amt,    0)  AS purchase_amt,
  COALESCE(pur.pur_return_qty,  0)  AS pur_return_qty,
  COALESCE(pur.pur_return_amt,  0)  AS pur_return_amt,
  GREATEST(0, COALESCE(pur.purchase_qty, 0) - COALESCE(pur.pur_return_qty, 0)) AS net_pur_qty,
  GREATEST(0, COALESCE(pur.purchase_amt, 0) - COALESCE(pur.pur_return_amt, 0)) AS net_pur_amt,
  COALESCE(sal.sale_qty,        0)  AS sale_qty,
  COALESCE(sal.sale_amt,        0)  AS sale_amt,
  0::NUMERIC                        AS sale_return_qty,
  0::NUMERIC                        AS sale_return_amt,
  COALESCE(sal.sale_qty,        0)  AS net_sale_qty,
  COALESCE(sal.sale_amt,        0)  AS net_sale_amt
FROM (
  SELECT DISTINCT tenant_id, product_name FROM products WHERE active = TRUE
) p
LEFT JOIN (
  SELECT
    sio.tenant_id,
    prod.product_name,
    SUM(CASE WHEN sil.invoice_type = 'purchase'
          THEN COALESCE(sal.arrived_qty, sil.qty) ELSE 0 END) AS purchase_qty,
    SUM(CASE WHEN sil.invoice_type = 'purchase'
          THEN COALESCE(sal.arrived_qty, sil.qty) * sil.rate ELSE 0 END) AS purchase_amt,
    SUM(CASE WHEN sil.invoice_type = 'return'
          THEN COALESCE(sal.arrived_qty, sil.qty) ELSE 0 END) AS pur_return_qty,
    SUM(CASE WHEN sil.invoice_type = 'return'
          THEN COALESCE(sal.arrived_qty, sil.qty) * sil.rate ELSE 0 END) AS pur_return_amt
  FROM sell_in_lines sil
  JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id
  JOIN products prod       ON prod.id = sil.product_id
  LEFT JOIN sell_in_arrived_lines sal ON sal.sell_in_line_id = sil.id
  WHERE sio.status IN ('stock_arrived','on_credit','billed')
  GROUP BY sio.tenant_id, prod.product_name
) pur ON pur.tenant_id = p.tenant_id AND LOWER(TRIM(pur.product_name)) = LOWER(TRIM(p.product_name))
LEFT JOIN (
  SELECT
    se.tenant_id,
    prod.product_name,
    SUM(sel.qty)    AS sale_qty,
    SUM(sel.amount) AS sale_amt
  FROM sale_entry_lines sel
  JOIN sale_entries se ON se.id = sel.sale_entry_id
  JOIN products prod   ON prod.id = sel.product_id
  GROUP BY se.tenant_id, prod.product_name
) sal ON sal.tenant_id = p.tenant_id AND LOWER(TRIM(sal.product_name)) = LOWER(TRIM(p.product_name))
WHERE (pur.purchase_qty IS NOT NULL AND pur.purchase_qty > 0)
   OR (sal.sale_qty     IS NOT NULL AND sal.sale_qty     > 0);


DROP FUNCTION IF EXISTS get_sale_purchase_filtered(TEXT, TEXT);

CREATE OR REPLACE FUNCTION get_sale_purchase_filtered(
  p_date_from TEXT DEFAULT NULL,
  p_date_to   TEXT DEFAULT NULL
)
RETURNS TABLE (
  product_name    TEXT,
  purchase_qty    NUMERIC,
  purchase_amt    NUMERIC,
  pur_return_qty  NUMERIC,
  pur_return_amt  NUMERIC,
  net_pur_qty     NUMERIC,
  net_pur_amt     NUMERIC,
  sale_qty        NUMERIC,
  sale_amt        NUMERIC,
  sale_return_qty NUMERIC,
  sale_return_amt NUMERIC,
  net_sale_qty    NUMERIC,
  net_sale_amt    NUMERIC
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tenant UUID := current_tenant_id();
BEGIN
  RETURN QUERY
  SELECT
    p.product_name::TEXT,
    COALESCE(pur.purchase_qty,   0),
    COALESCE(pur.purchase_amt,   0),
    COALESCE(pur.pur_return_qty, 0),
    COALESCE(pur.pur_return_amt, 0),
    GREATEST(0, COALESCE(pur.purchase_qty, 0) - COALESCE(pur.pur_return_qty, 0)),
    GREATEST(0, COALESCE(pur.purchase_amt, 0) - COALESCE(pur.pur_return_amt, 0)),
    COALESCE(sal.sale_qty,       0),
    COALESCE(sal.sale_amt,       0),
    0::NUMERIC,
    0::NUMERIC,
    COALESCE(sal.sale_qty,       0),
    COALESCE(sal.sale_amt,       0)
  FROM (
    SELECT DISTINCT product_name FROM products WHERE tenant_id = v_tenant AND active = TRUE
  ) p
  LEFT JOIN (
    SELECT
      prod.product_name,
      SUM(CASE WHEN sil.invoice_type = 'purchase'
            THEN COALESCE(sal.arrived_qty, sil.qty) ELSE 0 END) AS purchase_qty,
      SUM(CASE WHEN sil.invoice_type = 'purchase'
            THEN COALESCE(sal.arrived_qty, sil.qty) * sil.rate ELSE 0 END) AS purchase_amt,
      SUM(CASE WHEN sil.invoice_type = 'return'
            THEN COALESCE(sal.arrived_qty, sil.qty) ELSE 0 END) AS pur_return_qty,
      SUM(CASE WHEN sil.invoice_type = 'return'
            THEN COALESCE(sal.arrived_qty, sil.qty) * sil.rate ELSE 0 END) AS pur_return_amt
    FROM sell_in_lines sil
    JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id AND sio.tenant_id = v_tenant
    JOIN products prod       ON prod.id = sil.product_id
    LEFT JOIN sell_in_arrived_lines sal ON sal.sell_in_line_id = sil.id
    WHERE sio.status IN ('stock_arrived','on_credit','billed')
      AND (p_date_from IS NULL OR sio.transaction_date >= p_date_from::DATE)
      AND (p_date_to   IS NULL OR sio.transaction_date <= p_date_to::DATE)
    GROUP BY prod.product_name
  ) pur ON LOWER(TRIM(pur.product_name)) = LOWER(TRIM(p.product_name))
  LEFT JOIN (
    SELECT
      prod.product_name,
      SUM(sel.qty)    AS sale_qty,
      SUM(sel.amount) AS sale_amt
    FROM sale_entry_lines sel
    JOIN sale_entries se ON se.id = sel.sale_entry_id AND se.tenant_id = v_tenant
    JOIN products prod   ON prod.id = sel.product_id
    WHERE (p_date_from IS NULL OR se.sale_date >= p_date_from::DATE)
      AND (p_date_to   IS NULL OR se.sale_date <= p_date_to::DATE)
    GROUP BY prod.product_name
  ) sal ON LOWER(TRIM(sal.product_name)) = LOWER(TRIM(p.product_name))
  WHERE (pur.purchase_qty IS NOT NULL AND pur.purchase_qty > 0)
     OR (sal.sale_qty     IS NOT NULL AND sal.sale_qty     > 0)
  ORDER BY p.product_name;
END;
$$;

GRANT EXECUTE ON FUNCTION get_sale_purchase_filtered(TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
