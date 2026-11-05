-- ============================================================================
-- MDOS v48 — Complete 100% Stock Synchronization & Trigger Fix
--
-- 1. get_or_create_product_id: Strips discount annotations (+rate-rate)
-- 2. sync_invoice_line_items: Robust regex parser + clean product ID matching
-- 3. Clean up rogue products created by legacy discount string parsing
-- 4. Re-sync all invoice_line_items from invoices
-- 5. stock_balance_by_level VIEW & get_stock_balance_filtered RPC
-- 6. stock_ledger_view & stock_ledger_with_balance VIEW & get_stock_ledger RPC
-- 7. warehouse_standard_levels VIEW
-- 8. warehouse_rgb_levels VIEW
-- 9. warehouse_empties_levels VIEW
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Helper Function: get_or_create_product_id
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS get_or_create_product_id(UUID, TEXT) CASCADE;

CREATE OR REPLACE FUNCTION get_or_create_product_id(p_tenant_id UUID, p_product_name TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_clean_name TEXT;
  v_pid UUID;
BEGIN
  -- Strip discount annotations like +955-965 or +955.00-965.00
  v_clean_name := BTRIM(regexp_replace(p_product_name, '\+[\d\.]+\-[\d\.]+$', ''));
  IF v_clean_name = '' OR v_clean_name IS NULL THEN
    v_clean_name := BTRIM(p_product_name);
  END IF;

  -- 1. Look for exact match (case-insensitive) on clean name
  SELECT id INTO v_pid
  FROM products
  WHERE tenant_id = p_tenant_id
    AND LOWER(TRIM(product_name)) = LOWER(TRIM(v_clean_name))
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_pid IS NOT NULL THEN
    RETURN v_pid;
  END IF;

  -- 2. Look for exact match on raw name
  SELECT id INTO v_pid
  FROM products
  WHERE tenant_id = p_tenant_id
    AND LOWER(TRIM(product_name)) = LOWER(TRIM(p_product_name))
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_pid IS NOT NULL THEN
    RETURN v_pid;
  END IF;

  -- 3. If still not found, create new product with clean name
  INSERT INTO products (tenant_id, product_name, active)
  VALUES (p_tenant_id, v_clean_name, true)
  RETURNING id INTO v_pid;

  RETURN v_pid;
END;
$$;


-- ----------------------------------------------------------------------------
-- 2. Trigger Function: sync_invoice_line_items
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_invoice_line_items()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $fn$
DECLARE
  v_product          TEXT;
  v_parts            TEXT[];
  v_name             TEXT;
  v_clean_name       TEXT;
  v_qty              NUMERIC(12,2);
  v_pid              UUID;
  v_rate             NUMERIC(12,2);
  v_total_parsed_qty NUMERIC(12,2) := 0;
  v_grand_total      NUMERIC(14,2);
BEGIN
  DELETE FROM invoice_line_items WHERE invoice_id = NEW.id;

  IF NEW.products IS NULL OR TRIM(NEW.products) = '' THEN
    RETURN NEW;
  END IF;

  -- First pass: compute total qty
  FOR v_product IN
    SELECT BTRIM(p) FROM UNNEST(string_to_array(NEW.products, ',')) AS p
  LOOP
    IF v_product = '' THEN CONTINUE; END IF;

    IF POSITION(chr(215) IN v_product) > 0 THEN
      v_parts := string_to_array(v_product, chr(215));
      v_qty   := COALESCE(NULLIF(BTRIM(v_parts[2]), '')::NUMERIC, 1);
    ELSIF v_product ~* '[xX*]\s*[0-9]+$' THEN
      v_parts := regexp_split_to_array(v_product, '\s*[xX*]\s*');
      v_qty   := COALESCE(NULLIF(BTRIM(v_parts[array_length(v_parts, 1)]), '')::NUMERIC, 1);
    ELSE
      v_qty := 1;
    END IF;

    v_total_parsed_qty := v_total_parsed_qty + v_qty;
  END LOOP;

  v_grand_total :=
    COALESCE(NEW.grand_total,
      NEW.invoice_total - COALESCE(NEW.discount_amount, 0) + COALESCE(NEW.advance_tax, 0),
      0);

  -- Second pass: insert invoice_line_items
  FOR v_product IN
    SELECT BTRIM(p) FROM UNNEST(string_to_array(NEW.products, ',')) AS p
  LOOP
    IF v_product = '' THEN CONTINUE; END IF;

    IF POSITION(chr(215) IN v_product) > 0 THEN
      v_parts := string_to_array(v_product, chr(215));
      v_name  := BTRIM(v_parts[1]);
      v_qty   := COALESCE(NULLIF(BTRIM(v_parts[2]), '')::NUMERIC, 1);
    ELSIF v_product ~* '[xX*]\s*[0-9]+$' THEN
      v_parts := regexp_split_to_array(v_product, '\s*[xX*]\s*');
      v_name  := BTRIM(SUBSTRING(v_product FROM 1 FOR (LENGTH(v_product) - LENGTH(v_parts[array_length(v_parts, 1)]) - 1)));
      v_name  := BTRIM(regexp_replace(v_name, '\s*[xX*]\s*$', ''));
      v_qty   := COALESCE(NULLIF(BTRIM(v_parts[array_length(v_parts, 1)]), '')::NUMERIC, 1);
    ELSE
      v_name := BTRIM(v_product);
      v_qty  := 1;
    END IF;

    -- Strip discount annotation from name: e.g. "Coke 1.5L+955-965" -> "Coke 1.5L"
    v_clean_name := BTRIM(regexp_replace(v_name, '\+[\d\.]+\-[\d\.]+$', ''));
    IF v_clean_name = '' OR v_clean_name IS NULL THEN
      v_clean_name := v_name;
    END IF;

    v_pid := get_or_create_product_id(NEW.tenant_id, v_clean_name);

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


-- ----------------------------------------------------------------------------
-- 3. Clean up rogue products created with discount suffixes and re-sync invoices
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
  v_canonical_id UUID;
  v_clean_title TEXT;
BEGIN
  FOR r IN (
    SELECT id, tenant_id, product_name
    FROM products
    WHERE product_name ~ '\+[\d\.]+\-[\d\.]+$'
  ) LOOP
    v_clean_title := BTRIM(regexp_replace(r.product_name, '\+[\d\.]+\-[\d\.]+$', ''));
    SELECT id INTO v_canonical_id
    FROM products
    WHERE tenant_id = r.tenant_id
      AND LOWER(TRIM(product_name)) = LOWER(TRIM(v_clean_title))
      AND id <> r.id
    ORDER BY created_at ASC
    LIMIT 1;

    IF v_canonical_id IS NOT NULL THEN
      UPDATE invoice_line_items SET product_id = v_canonical_id WHERE product_id = r.id;
      UPDATE damaged_stock SET product_name = v_clean_title WHERE product_name = r.product_name;
      DELETE FROM products WHERE id = r.id;
    END IF;
  END LOOP;
END $$;

-- Force re-sync all invoice line items
UPDATE invoices SET products = products WHERE products IS NOT NULL;


-- ----------------------------------------------------------------------------
-- 4. Unified stock_balance_by_level VIEW & get_stock_balance_filtered RPC
-- ----------------------------------------------------------------------------
DROP VIEW IF EXISTS stock_balance_by_level CASCADE;

CREATE OR REPLACE VIEW stock_balance_by_level WITH (security_invoker = TRUE) AS
WITH prod_cats AS (
  SELECT DISTINCT ON (p.tenant_id, LOWER(TRIM(p.product_name)))
    p.tenant_id,
    LOWER(TRIM(p.product_name)) AS norm_name,
    pc.is_returnable,
    pc.is_rgb
  FROM products p
  JOIN product_categories pc ON pc.id = p.category_id
  ORDER BY p.tenant_id, LOWER(TRIM(p.product_name)), p.created_at DESC
),
ins AS (
  SELECT
    sio.tenant_id,
    LOWER(TRIM(p.product_name)) AS norm_name,
    SUM(COALESCE(sal.arrived_qty, sil.qty) - COALESCE(sal.returned_qty, 0)) AS qty_in
  FROM sell_in_lines sil
  LEFT JOIN sell_in_arrived_lines sal ON sal.sell_in_line_id = sil.id
  JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id
  JOIN products p ON p.id = sil.product_id
  WHERE sio.status IN ('stock_arrived', 'on_credit', 'billed')
    AND (sil.invoice_type IS NULL OR sil.invoice_type = 'purchase')
  GROUP BY sio.tenant_id, LOWER(TRIM(p.product_name))
),
outs_gross AS (
  SELECT
    ili.tenant_id,
    LOWER(TRIM(p.product_name)) AS norm_name,
    SUM(ili.quantity) AS gross_qty_out
  FROM invoice_line_items ili
  JOIN invoices inv ON inv.id = ili.invoice_id
  JOIN products p   ON p.id   = ili.product_id
  WHERE (inv.delivery_status IS NULL OR inv.delivery_status <> 'cancelled')
  GROUP BY ili.tenant_id, LOWER(TRIM(p.product_name))
),
returns_deduct AS (
  SELECT
    ir.tenant_id,
    LOWER(TRIM(ir.product_name)) AS norm_name,
    SUM(ir.returned_qty) AS returned_qty
  FROM invoice_returns ir
  GROUP BY ir.tenant_id, LOWER(TRIM(ir.product_name))
),
damaged_out AS (
  SELECT
    ds.tenant_id,
    LOWER(TRIM(ds.product_name)) AS norm_name,
    SUM(ds.quantity) AS damaged_qty
  FROM damaged_stock ds
  GROUP BY ds.tenant_id, LOWER(TRIM(ds.product_name))
),
all_names AS (
  SELECT tenant_id, norm_name FROM ins
  UNION SELECT tenant_id, norm_name FROM outs_gross
  UNION SELECT tenant_id, norm_name FROM returns_deduct
  UNION SELECT tenant_id, norm_name FROM damaged_out
),
prod_meta AS (
  SELECT
    p.tenant_id,
    LOWER(TRIM(p.product_name)) AS norm_name,
    MAX(p.product_name) AS product_name,
    MAX(COALESCE(p.packing_qty, 1)) AS packing_qty
  FROM products p
  GROUP BY p.tenant_id, LOWER(TRIM(p.product_name))
)
SELECT
  an.tenant_id,
  COALESCE(pm.product_name, INITCAP(an.norm_name)) AS product_name,
  COALESCE(pm.packing_qty, 1)::NUMERIC AS packing_qty,
  COALESCE(ins.qty_in, 0)::NUMERIC AS total_qty_in,
  (COALESCE(og.gross_qty_out, 0) - COALESCE(rd.returned_qty, 0) + COALESCE(dmg.damaged_qty, 0))::NUMERIC AS total_qty_out,
  (COALESCE(ins.qty_in, 0) - (COALESCE(og.gross_qty_out, 0) - COALESCE(rd.returned_qty, 0) + COALESCE(dmg.damaged_qty, 0)))::NUMERIC AS net_balance
FROM all_names an
LEFT JOIN prod_meta pm   ON pm.tenant_id = an.tenant_id AND pm.norm_name = an.norm_name
LEFT JOIN ins            ON ins.tenant_id = an.tenant_id AND ins.norm_name = an.norm_name
LEFT JOIN outs_gross og  ON og.tenant_id  = an.tenant_id AND og.norm_name  = an.norm_name
LEFT JOIN returns_deduct rd ON rd.tenant_id = an.tenant_id AND rd.norm_name = an.norm_name
LEFT JOIN damaged_out dmg ON dmg.tenant_id = an.tenant_id AND dmg.norm_name = an.norm_name;

DROP FUNCTION IF EXISTS get_stock_balance_filtered(TEXT, TEXT);

CREATE OR REPLACE FUNCTION get_stock_balance_filtered(
  p_date_from TEXT DEFAULT NULL,
  p_date_to   TEXT DEFAULT NULL
)
RETURNS TABLE (
  tenant_id       UUID,
  product_name    TEXT,
  packing_qty     NUMERIC,
  total_qty_in    NUMERIC,
  total_qty_out   NUMERIC,
  net_balance     NUMERIC
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tenant_id UUID;
BEGIN
  v_tenant_id := current_tenant_id();

  RETURN QUERY
  WITH prod_cats AS (
    SELECT DISTINCT ON (p.tenant_id, LOWER(TRIM(p.product_name)))
      p.tenant_id,
      LOWER(TRIM(p.product_name)) AS norm_name,
      pc.is_returnable,
      pc.is_rgb
    FROM products p
    JOIN product_categories pc ON pc.id = p.category_id
    WHERE p.tenant_id = v_tenant_id
    ORDER BY p.tenant_id, LOWER(TRIM(p.product_name)), p.created_at DESC
  ),
  ins AS (
    SELECT
      LOWER(TRIM(p.product_name)) AS norm_name,
      SUM(COALESCE(sal.arrived_qty, sil.qty) - COALESCE(sal.returned_qty, 0)) AS qty_in
    FROM sell_in_lines sil
    LEFT JOIN sell_in_arrived_lines sal ON sal.sell_in_line_id = sil.id
    JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id
    JOIN products       p   ON p.id   = sil.product_id
    WHERE sio.tenant_id = v_tenant_id
      AND sio.status IN ('stock_arrived', 'on_credit', 'billed')
      AND (sil.invoice_type IS NULL OR sil.invoice_type = 'purchase')
      AND (p_date_from IS NULL OR sio.transaction_date >= p_date_from::DATE)
      AND (p_date_to   IS NULL OR sio.transaction_date <= p_date_to::DATE)
    GROUP BY LOWER(TRIM(p.product_name))
  ),
  outs_gross AS (
    SELECT
      LOWER(TRIM(p.product_name)) AS norm_name,
      SUM(ili.quantity) AS gross_qty_out
    FROM invoice_line_items ili
    JOIN invoices inv ON inv.id = ili.invoice_id
    JOIN products p   ON p.id   = ili.product_id
    WHERE ili.tenant_id = v_tenant_id
      AND (inv.delivery_status IS NULL OR inv.delivery_status <> 'cancelled')
      AND (p_date_from IS NULL OR inv.invoice_date >= p_date_from::DATE)
      AND (p_date_to   IS NULL OR inv.invoice_date <= p_date_to::DATE)
    GROUP BY LOWER(TRIM(p.product_name))
  ),
  returns_deduct AS (
    SELECT
      LOWER(TRIM(ir.product_name)) AS norm_name,
      SUM(ir.returned_qty) AS returned_qty
    FROM invoice_returns ir
    WHERE ir.tenant_id = v_tenant_id
      AND (p_date_from IS NULL OR ir.return_date >= p_date_from::DATE)
      AND (p_date_to   IS NULL OR ir.return_date <= p_date_to::DATE)
    GROUP BY LOWER(TRIM(ir.product_name))
  ),
  damaged_out AS (
    SELECT
      LOWER(TRIM(ds.product_name)) AS norm_name,
      SUM(ds.quantity) AS damaged_qty
    FROM damaged_stock ds
    WHERE ds.tenant_id = v_tenant_id
      AND (p_date_from IS NULL OR ds.recorded_date >= p_date_from::DATE)
      AND (p_date_to   IS NULL OR ds.recorded_date <= p_date_to::DATE)
    GROUP BY LOWER(TRIM(ds.product_name))
  ),
  all_names AS (
    SELECT norm_name FROM ins
    UNION SELECT norm_name FROM outs_gross
    UNION SELECT norm_name FROM returns_deduct
    UNION SELECT norm_name FROM damaged_out
  ),
  prod_meta AS (
    SELECT
      LOWER(TRIM(p.product_name)) AS norm_name,
      MAX(p.product_name) AS product_name,
      MAX(COALESCE(p.packing_qty, 1)) AS packing_qty
    FROM products p
    WHERE p.tenant_id = v_tenant_id
    GROUP BY LOWER(TRIM(p.product_name))
  )
  SELECT
    v_tenant_id AS tenant_id,
    COALESCE(pm.product_name, INITCAP(an.norm_name)) AS product_name,
    COALESCE(pm.packing_qty, 1)::NUMERIC AS packing_qty,
    COALESCE(ins.qty_in, 0)::NUMERIC AS total_qty_in,
    (COALESCE(og.gross_qty_out, 0) - COALESCE(rd.returned_qty, 0) + COALESCE(dmg.damaged_qty, 0))::NUMERIC AS total_qty_out,
    (COALESCE(ins.qty_in, 0) - (COALESCE(og.gross_qty_out, 0) - COALESCE(rd.returned_qty, 0) + COALESCE(dmg.damaged_qty, 0)))::NUMERIC AS net_balance
  FROM all_names an
  LEFT JOIN prod_meta pm   ON pm.norm_name = an.norm_name
  LEFT JOIN ins            ON ins.norm_name = an.norm_name
  LEFT JOIN outs_gross og  ON og.norm_name  = an.norm_name
  LEFT JOIN returns_deduct rd ON rd.norm_name = an.norm_name
  LEFT JOIN damaged_out dmg ON dmg.norm_name = an.norm_name
  ORDER BY product_name;
END;
$$;

GRANT EXECUTE ON FUNCTION get_stock_balance_filtered(TEXT, TEXT) TO authenticated;


-- ----------------------------------------------------------------------------
-- 5. Unified stock_ledger_view & stock_ledger_with_balance & get_stock_ledger RPC
-- ----------------------------------------------------------------------------
DROP VIEW IF EXISTS stock_ledger_with_balance CASCADE;
DROP VIEW IF EXISTS stock_ledger_view CASCADE;

CREATE OR REPLACE VIEW stock_ledger_view WITH (security_invoker = TRUE) AS

-- Sell In
SELECT
  sio.tenant_id,
  sio.transaction_date                                             AS date,
  p.product_name,
  p.id                                                             AS product_id,
  'IN'::TEXT                                                       AS direction,
  'Sell In — ' || COALESCE(sio.po_no, 'PO-' || SUBSTRING(sio.id::TEXT, 1, 6)) AS source,
  'sell_in'::TEXT                                                  AS source_type,
  COALESCE(sio.po_no, '')                                          AS source_ref,
  COALESCE(sal.arrived_qty - COALESCE(sal.returned_qty, 0), sil.qty) AS qty,
  COALESCE(sal.id, sil.id)                                         AS event_id,
  COALESCE(sal.created_at, sil.created_at)                         AS event_ts
FROM sell_in_lines sil
JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id
JOIN products       p   ON p.id   = sil.product_id
LEFT JOIN sell_in_arrived_lines sal ON sal.sell_in_line_id = sil.id
WHERE sio.status IN ('stock_arrived', 'on_credit', 'billed')
  AND (sil.invoice_type IS NULL OR sil.invoice_type = 'purchase')
  AND COALESCE(sal.arrived_qty - COALESCE(sal.returned_qty, 0), sil.qty) > 0

UNION ALL

-- Invoices
SELECT
  ili.tenant_id,
  inv.invoice_date                                                 AS date,
  MAX(p.product_name)                                              AS product_name,
  (MIN(p.id::TEXT))::UUID                                          AS product_id,
  'OUT'::TEXT                                                      AS direction,
  'Invoice — View'::TEXT                                           AS source,
  'invoice'::TEXT                                                  AS source_type,
  ''::TEXT                                                         AS source_ref,
  SUM(ili.quantity)                                                AS qty,
  (MIN(ili.id::TEXT))::UUID                                        AS event_id,
  MIN(ili.created_at)                                              AS event_ts
FROM invoice_line_items ili
JOIN invoices inv ON inv.id  = ili.invoice_id
JOIN products p   ON p.id   = ili.product_id
WHERE (inv.delivery_status IS NULL OR inv.delivery_status <> 'cancelled')
  AND ili.quantity > 0
GROUP BY ili.tenant_id, inv.invoice_date, LOWER(TRIM(p.product_name))

UNION ALL

-- Damaged Stock
SELECT
  ds.tenant_id,
  ds.recorded_date                                                 AS date,
  COALESCE(p.product_name, ds.product_name)                        AS product_name,
  p.id                                                             AS product_id,
  'OUT'::TEXT                                                      AS direction,
  'Damaged Stock — ' || COALESCE(NULLIF(ds.webspace_ref, ''), 'DMG-' || UPPER(SUBSTRING(ds.id::TEXT, 1, 6))) AS source,
  'damaged_stock'::TEXT                                            AS source_type,
  COALESCE(ds.webspace_ref, '')                                    AS source_ref,
  ds.quantity                                                      AS qty,
  ds.id                                                            AS event_id,
  ds.created_at                                                    AS event_ts
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

-- Returns
SELECT
  ir.tenant_id,
  ir.return_date                                                   AS date,
  COALESCE(MAX(p.product_name), MAX(ir.product_name))              AS product_name,
  (MIN(p.id::TEXT))::UUID                                          AS product_id,
  'IN'::TEXT                                                       AS direction,
  'Returns & Wayback — View'::TEXT                                 AS source,
  'returns'::TEXT                                                  AS source_type,
  ''::TEXT                                                         AS source_ref,
  SUM(ir.returned_qty)                                             AS qty,
  (MIN(ir.id::TEXT))::UUID                                         AS event_id,
  MIN(ir.created_at)                                               AS event_ts
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


-- ----------------------------------------------------------------------------
-- 6. Warehouse Views: standard, rgb, empties
-- ----------------------------------------------------------------------------
DROP VIEW IF EXISTS warehouse_rgb_levels CASCADE;
DROP VIEW IF EXISTS warehouse_empties_levels CASCADE;
DROP VIEW IF EXISTS warehouse_standard_levels CASCADE;

-- Standard (Non-Returnable) Levels
CREATE VIEW warehouse_standard_levels WITH (security_invoker = TRUE) AS
SELECT
  pc.tenant_id,
  pc.id                                    AS category_id,
  pc.title                                 AS category_title,
  p.id                                     AS product_id,
  COALESCE(p.product_code, p.product_name) AS code,
  p.product_name,
  GREATEST(0,
    -- Arrived purchases minus PO returns
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
      WHERE sio.tenant_id  = pc.tenant_id
        AND LOWER(TRIM(sil_p.product_name)) = LOWER(TRIM(p.product_name))
        AND sio.status     IN ('stock_arrived','on_credit','billed')
    ), 0)
    -- Deduct net invoiced (Invoiced - Shop Returns)
    - (
        COALESCE((
          SELECT SUM(ili.quantity) FROM invoice_line_items ili
          JOIN invoices inv ON inv.id = ili.invoice_id
          JOIN products ili_p ON ili_p.id = ili.product_id
          WHERE ili.tenant_id  = pc.tenant_id
            AND LOWER(TRIM(ili_p.product_name)) = LOWER(TRIM(p.product_name))
            AND (inv.delivery_status IS NULL OR inv.delivery_status <> 'cancelled')
        ), 0)
        - COALESCE((
          SELECT SUM(ir.returned_qty) FROM invoice_returns ir
          WHERE ir.tenant_id    = pc.tenant_id
            AND LOWER(TRIM(ir.product_name)) = LOWER(TRIM(p.product_name))
        ), 0)
      )
    -- Deduct damaged stock
    - COALESCE((
      SELECT SUM(ds.quantity) FROM damaged_stock ds
      WHERE ds.tenant_id    = pc.tenant_id
        AND LOWER(TRIM(ds.product_name)) = LOWER(TRIM(p.product_name))
    ), 0)
  )                                        AS total_qty,
  COALESCE((
    SELECT SUM(ds.quantity) FROM damaged_stock ds
    WHERE ds.tenant_id    = pc.tenant_id
      AND LOWER(TRIM(ds.product_name)) = LOWER(TRIM(p.product_name))
      AND ds.status       <> 'adjusted'
  ), 0)                                    AS flappy
FROM product_categories pc
JOIN products p ON p.category_id = pc.id
WHERE pc.is_returnable = FALSE
  AND p.active = TRUE;

-- RGB Levels
CREATE VIEW warehouse_rgb_levels WITH (security_invoker = TRUE) AS
SELECT
  pc.tenant_id,
  p.id                                     AS product_id,
  COALESCE(p.product_code, p.product_name) AS code,
  p.product_name,
  -- Total physical quantity arrived in warehouse
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
    WHERE sio.tenant_id  = pc.tenant_id
      AND LOWER(TRIM(sil_p.product_name)) = LOWER(TRIM(p.product_name))
      AND sio.status     IN ('stock_arrived','on_credit','billed')
  ), 0))                                   AS total_qty,
  -- Returned empties from shops
  GREATEST(0, COALESCE((
    SELECT SUM(ir.returned_qty) FROM invoice_returns ir
    WHERE ir.tenant_id    = pc.tenant_id
      AND LOWER(TRIM(ir.product_name)) = LOWER(TRIM(p.product_name))
  ), 0))                                   AS returned,
  -- Unreturned with shops: Invoiced - Returned
  GREATEST(0,
    COALESCE((
      SELECT SUM(ili.quantity) FROM invoice_line_items ili
      JOIN invoices inv ON inv.id = ili.invoice_id
      JOIN products ili_p ON ili_p.id = ili.product_id
      WHERE ili.tenant_id  = pc.tenant_id
        AND LOWER(TRIM(ili_p.product_name)) = LOWER(TRIM(p.product_name))
        AND (inv.delivery_status IS NULL OR inv.delivery_status <> 'cancelled')
    ), 0)
    - COALESCE((
      SELECT SUM(ir.returned_qty) FROM invoice_returns ir
      WHERE ir.tenant_id    = pc.tenant_id
        AND LOWER(TRIM(ir.product_name)) = LOWER(TRIM(p.product_name))
    ), 0)
  )                                        AS unreturned,
  -- Available in warehouse: Total arrived - Unreturned with shops - Damaged stock
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
      WHERE sio.tenant_id  = pc.tenant_id
        AND LOWER(TRIM(sil_p.product_name)) = LOWER(TRIM(p.product_name))
        AND sio.status     IN ('stock_arrived','on_credit','billed')
    ), 0)
    - (
        COALESCE((
          SELECT SUM(ili.quantity) FROM invoice_line_items ili
          JOIN invoices inv ON inv.id = ili.invoice_id
          JOIN products ili_p ON ili_p.id = ili.product_id
          WHERE ili.tenant_id  = pc.tenant_id
            AND LOWER(TRIM(ili_p.product_name)) = LOWER(TRIM(p.product_name))
            AND (inv.delivery_status IS NULL OR inv.delivery_status <> 'cancelled')
        ), 0)
        - COALESCE((
          SELECT SUM(ir.returned_qty) FROM invoice_returns ir
          WHERE ir.tenant_id    = pc.tenant_id
            AND LOWER(TRIM(ir.product_name)) = LOWER(TRIM(p.product_name))
        ), 0)
      )
    - COALESCE((
      SELECT SUM(ds.quantity) FROM damaged_stock ds
      WHERE ds.tenant_id    = pc.tenant_id
        AND LOWER(TRIM(ds.product_name)) = LOWER(TRIM(p.product_name))
    ), 0)
  )                                        AS available
FROM product_categories pc
JOIN products p ON p.category_id = pc.id
WHERE pc.is_returnable = TRUE
  AND pc.is_rgb = TRUE
  AND p.active = TRUE;

-- Empties Levels
CREATE VIEW warehouse_empties_levels WITH (security_invoker = TRUE) AS
SELECT
  pc.tenant_id,
  p.id                                     AS product_id,
  COALESCE(p.product_code, p.product_name) AS code,
  p.product_name,
  -- Total physical quantity arrived in warehouse
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
    WHERE sio.tenant_id  = pc.tenant_id
      AND LOWER(TRIM(sil_p.product_name)) = LOWER(TRIM(p.product_name))
      AND sio.status     IN ('stock_arrived','on_credit','billed')
  ), 0))                                   AS total_qty,
  -- Returned empties from shops
  GREATEST(0, COALESCE((
    SELECT SUM(ir.returned_qty) FROM invoice_returns ir
    WHERE ir.tenant_id    = pc.tenant_id
      AND LOWER(TRIM(ir.product_name)) = LOWER(TRIM(p.product_name))
  ), 0))                                   AS returned,
  -- Unreturned with shops: Invoiced - Returned
  GREATEST(0,
    COALESCE((
      SELECT SUM(ili.quantity) FROM invoice_line_items ili
      JOIN invoices inv ON inv.id = ili.invoice_id
      JOIN products ili_p ON ili_p.id = ili.product_id
      WHERE ili.tenant_id  = pc.tenant_id
        AND LOWER(TRIM(ili_p.product_name)) = LOWER(TRIM(p.product_name))
        AND (inv.delivery_status IS NULL OR inv.delivery_status <> 'cancelled')
    ), 0)
    - COALESCE((
      SELECT SUM(ir.returned_qty) FROM invoice_returns ir
      WHERE ir.tenant_id    = pc.tenant_id
        AND LOWER(TRIM(ir.product_name)) = LOWER(TRIM(p.product_name))
    ), 0)
  )                                        AS unreturned,
  -- Available in warehouse: Total arrived - Unreturned with shops - Damaged stock
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
      WHERE sio.tenant_id  = pc.tenant_id
        AND LOWER(TRIM(sil_p.product_name)) = LOWER(TRIM(p.product_name))
        AND sio.status     IN ('stock_arrived','on_credit','billed')
    ), 0)
    - (
        COALESCE((
          SELECT SUM(ili.quantity) FROM invoice_line_items ili
          JOIN invoices inv ON inv.id = ili.invoice_id
          JOIN products ili_p ON ili_p.id = ili.product_id
          WHERE ili.tenant_id  = pc.tenant_id
            AND LOWER(TRIM(ili_p.product_name)) = LOWER(TRIM(p.product_name))
            AND (inv.delivery_status IS NULL OR inv.delivery_status <> 'cancelled')
        ), 0)
        - COALESCE((
          SELECT SUM(ir.returned_qty) FROM invoice_returns ir
          WHERE ir.tenant_id    = pc.tenant_id
            AND LOWER(TRIM(ir.product_name)) = LOWER(TRIM(p.product_name))
        ), 0)
      )
    - COALESCE((
      SELECT SUM(ds.quantity) FROM damaged_stock ds
      WHERE ds.tenant_id    = pc.tenant_id
        AND LOWER(TRIM(ds.product_name)) = LOWER(TRIM(p.product_name))
    ), 0)
  )                                        AS available
FROM product_categories pc
JOIN products p ON p.category_id = pc.id
WHERE pc.is_returnable = TRUE
  AND (pc.is_rgb = FALSE OR pc.is_rgb IS NULL)
  AND p.active = TRUE;

NOTIFY pgrst, 'reload schema';
