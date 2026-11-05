-- ============================================================================
-- MDOS v68 — FIFO Costing Engine  (v4 — DEFINITIVE)
--
-- COMPLETE BUG HISTORY:
--
--   Bug 1 (v1→v2): fifo_batch_remaining read stale consumed_qty
--   Bug 2 (v1→v2): total_out anchored on invoice_line_items — damage-only SKUs invisible
--   Bug 3 (v1→v2): get_fifo_cogs filtered WHERE units_sold > 0 — damage excluded from COGS
--   Bug 4 (v1→v2): INTERVAL '1 day' returned TIMESTAMP not DATE
--   Bug 5 (v2→v3): FIFO window formula wrong for batches after total_out exhausted
--   Bug 6 (v3→v4): arrived_qty in trigger not netted for returned_qty (supplier returns)
--   Bug 7 (v3→v4): arrived_qty in backfill not netted for returned_qty
--   Bug 8 (v3→v4): GREATEST(0,cogs) clamping breaks equation in net-return periods
--                  PROOF: Opening+Purchases=COGS+Closing holds with raw delta but not
--                  when COGS is clamped to 0 while closing_stock correctly shows
--                  the returned stock.
--   Bug 9 (v3→v4): Placeholder _fifo_compute_cost function created DB noise
--   Bug 10 (v3→v4): Tiebreaker ORDER BY fbl.id is random UUID — inconsistent with
--                   DO block which ordered by created_at
--   Bug 11 (v3→v4): No trigger for on_credit/billed orders that skip arrived_lines flow
--   Bug 12 (v3→v4): Backfill LEFT JOIN produced multiple rows for same sell_in_line_id
--                   when multiple arrived records existed; ON CONFLICT DO NOTHING silently
--                   discarded the extra records, understating arrived_qty
--   Bug 13 (v3→v4): Trigger ON CONFLICT DO UPDATE overwrote arrived_qty with single
--                   arrival instead of recomputing total from all arrived lines
--
-- ACCOUNTING IDENTITY PROOF:
--   Let cost_IN(d)  = SUM(batch_value WHERE purchase_date <= d)
--       cost_OUT(d) = FIFO cumulative cost consumed up to date d
--       closing(d)  = cost_IN(d) - cost_OUT(d)
--
--   opening  = closing(period_start - 1) = cost_IN(d-1) - cost_OUT(d-1)
--   purchases= cost_IN(d_end) - cost_IN(d-1)
--   cogs     = cost_OUT(d_end) - cost_OUT(d-1)   [raw, may be negative if returns > sales]
--   closing  = cost_IN(d_end) - cost_OUT(d_end)
--
--   LHS = opening + purchases = cost_IN(d_end) - cost_OUT(d-1)
--   RHS = cogs + closing      = cost_IN(d_end) - cost_OUT(d-1)
--   LHS = RHS  (always, without any clamping)
--
-- Prerequisites: all migrations up to v67 must already be applied.
-- Safe to re-run (CREATE OR REPLACE / IF NOT EXISTS / ON CONFLICT DO NOTHING).
-- ============================================================================


-- ============================================================================
-- B. FIFO BATCH LEDGER TABLE
--
--    One row per sell_in_line_id (unique per purchase PO line).
--    arrived_qty = NET units that entered our warehouse
--                = gross_arrived - returned_to_supplier
--    rate        = agreed PO rate (from sell_in_lines.rate, locked at order time)
--    batch_value = arrived_qty * rate  (generated, immutable once set)
--
--    consumed_qty: written by backfill DO block only.
--    NOT maintained on sales or returns. Do NOT use for accounting.
--    Use get_fifo_closing_stock() or fifo_batch_remaining (both compute live).
-- ============================================================================

CREATE TABLE IF NOT EXISTS fifo_batch_ledger (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID          NOT NULL REFERENCES tenants(id)           ON DELETE CASCADE,
  sell_in_order_id    UUID          NOT NULL REFERENCES sell_in_orders(id)    ON DELETE CASCADE,
  sell_in_line_id     UUID          NOT NULL REFERENCES sell_in_lines(id)     ON DELETE CASCADE,
  sell_in_arrived_id  UUID          REFERENCES sell_in_arrived_lines(id)      ON DELETE SET NULL,
  product_id          UUID          NOT NULL REFERENCES products(id),

  purchase_date       DATE          NOT NULL,
  po_no               TEXT,

  -- Net quantity: gross_arrived - returned_to_supplier (Bug 6/7 fix)
  arrived_qty         NUMERIC(12,2) NOT NULL CHECK (arrived_qty > 0),
  rate                NUMERIC(12,4) NOT NULL CHECK (rate >= 0),
  batch_value         NUMERIC(16,4) GENERATED ALWAYS AS (arrived_qty * rate) STORED,

  consumed_qty        NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (consumed_qty >= 0),
  remaining_qty       NUMERIC(12,2) GENERATED ALWAYS AS (arrived_qty - consumed_qty) STORED,

  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT uq_fifo_batch_sell_in_line UNIQUE (sell_in_line_id)
);

-- Index drives all FIFO window functions (tenant → product → date → id)
CREATE INDEX IF NOT EXISTS idx_fifo_batch_tenant_product_date
  ON fifo_batch_ledger (tenant_id, product_id, purchase_date, created_at, id);

ALTER TABLE fifo_batch_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fifo_batch_ledger_tenant_isolation ON fifo_batch_ledger;
CREATE POLICY fifo_batch_ledger_tenant_isolation ON fifo_batch_ledger FOR ALL
  TO authenticated
  USING  (tenant_id = (SELECT current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT current_tenant_id()));

CREATE OR REPLACE FUNCTION _fifo_batch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_fifo_batch_updated_at ON fifo_batch_ledger;
CREATE TRIGGER trg_fifo_batch_updated_at
  BEFORE UPDATE ON fifo_batch_ledger
  FOR EACH ROW EXECUTE FUNCTION _fifo_batch_updated_at();


-- ============================================================================
-- C. BACKFILL — seed fifo_batch_ledger from all historical confirmed purchases
--
--    Bug 7 fix: stores NET arrived_qty (arrived - returned_to_supplier).
--    Bug 12 fix: aggregates multiple sell_in_arrived_lines rows per sell_in_line
--                so partial deliveries are totalled, not just the first row.
--    Idempotent via ON CONFLICT DO NOTHING on sell_in_line_id.
-- ============================================================================

INSERT INTO fifo_batch_ledger (
  tenant_id, sell_in_order_id, sell_in_line_id, sell_in_arrived_id,
  product_id, purchase_date, po_no, arrived_qty, rate, consumed_qty
)
SELECT
  sio.tenant_id,
  sio.id                                                       AS sell_in_order_id,
  sil.id                                                       AS sell_in_line_id,
  sal.latest_arrived_id,
  sil.product_id,
  sio.transaction_date                                         AS purchase_date,
  sio.po_no,
  -- Bug 7: NET qty = gross arrived minus any units returned to supplier at delivery
  GREATEST(0,
    COALESCE(sal.total_arrived, sil.qty)
    - COALESCE(sal.total_returned, 0)
  )                                                            AS arrived_qty,
  COALESCE(sil.rate, 0)                                        AS rate,
  0                                                            AS consumed_qty
FROM sell_in_lines sil
JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id
-- Bug 12: aggregate all arrived records per line (handles partial deliveries)
LEFT JOIN (
  SELECT
    sell_in_line_id,
    (ARRAY_AGG(id ORDER BY created_at DESC))[1] AS latest_arrived_id,
    SUM(arrived_qty)                            AS total_arrived,
    SUM(COALESCE(returned_qty, 0))              AS total_returned
  FROM sell_in_arrived_lines
  GROUP BY sell_in_line_id
) sal ON sal.sell_in_line_id = sil.id
WHERE sio.status IN ('stock_arrived', 'on_credit', 'billed')
  AND (sil.invoice_type IS NULL OR sil.invoice_type = 'purchase')
  AND GREATEST(0,
        COALESCE(sal.total_arrived, sil.qty) - COALESCE(sal.total_returned, 0)
      ) > 0
ON CONFLICT (sell_in_line_id) DO NOTHING;


-- ============================================================================
-- C2. RECOMPUTE consumed_qty for reference (not used by accounting functions)
--
--     Walks all batches oldest→newest per (tenant, product) and assigns
--     consumed_qty based on total NET outflows across all time.
--     Sources: invoice sales + adjusted damage − non-RGB shop returns.
-- ============================================================================

DO $$
DECLARE
  r_tenant  RECORD;
  r_product RECORD;
  r_batch   RECORD;
  v_total_out NUMERIC(12,2);
  v_remaining NUMERIC(12,2);
  v_consume   NUMERIC(12,2);
BEGIN
  FOR r_tenant IN SELECT DISTINCT tenant_id FROM fifo_batch_ledger LOOP
    FOR r_product IN
      SELECT DISTINCT product_id
      FROM fifo_batch_ledger
      WHERE tenant_id = r_tenant.tenant_id
    LOOP
      -- Net OUT across all time: sales + damage - shop returns (floor 0)
      SELECT GREATEST(0,
        -- Invoice sales (delivered, not cancelled)
        COALESCE((
          SELECT SUM(ili.quantity)
          FROM invoice_line_items ili
          JOIN invoices inv ON inv.id = ili.invoice_id
          WHERE ili.tenant_id  = r_tenant.tenant_id
            AND ili.product_id = r_product.product_id
            AND (inv.delivery_status IS NULL OR inv.delivery_status <> 'cancelled')
        ), 0)
        -- Adjusted damaged stock
        + COALESCE((
          SELECT SUM(ds.quantity)
          FROM damaged_stock ds
          JOIN products px ON px.tenant_id = ds.tenant_id
            AND LOWER(TRIM(px.product_name)) = LOWER(TRIM(ds.product_name))
          WHERE ds.tenant_id = r_tenant.tenant_id
            AND px.id        = r_product.product_id
            AND ds.status    = 'adjusted'
        ), 0)
        -- Non-RGB shop returns restore stock (subtract from OUT)
        - COALESCE((
          SELECT SUM(ir.returned_qty)
          FROM invoice_returns ir
          JOIN products px ON px.tenant_id = ir.tenant_id
            AND LOWER(TRIM(px.product_name)) = LOWER(TRIM(ir.product_name))
          JOIN product_categories pc ON pc.id = px.category_id
          WHERE ir.tenant_id    = r_tenant.tenant_id
            AND px.id            = r_product.product_id
            AND pc.is_returnable = FALSE
        ), 0)
      ) INTO v_total_out;

      v_remaining := v_total_out;

      -- Walk batches oldest first (Bug 10 fix: consistent ordering)
      FOR r_batch IN
        SELECT id, arrived_qty
        FROM fifo_batch_ledger
        WHERE tenant_id  = r_tenant.tenant_id
          AND product_id = r_product.product_id
        ORDER BY purchase_date ASC, created_at ASC, id ASC
      LOOP
        IF v_remaining <= 0 THEN
          UPDATE fifo_batch_ledger SET consumed_qty = 0     WHERE id = r_batch.id;
        ELSE
          v_consume := LEAST(r_batch.arrived_qty, v_remaining);
          UPDATE fifo_batch_ledger SET consumed_qty = v_consume WHERE id = r_batch.id;
          v_remaining := v_remaining - v_consume;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
END;
$$;


-- ============================================================================
-- D1. TRIGGER: sell_in_arrived_lines  (stock_arrived flow)
--
--     Fires after INSERT or UPDATE on sell_in_arrived_lines.
--     Bug 6 fix: stores NET arrived_qty = arrived - returned_to_supplier.
--     Bug 13 fix: ON CONFLICT recomputes total from ALL arrived lines for
--                 the sell_in_line (handles partial-delivery scenarios).
-- ============================================================================

CREATE OR REPLACE FUNCTION _fifo_on_sell_in_arrived()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_sil     sell_in_lines%ROWTYPE;
  v_sio     sell_in_orders%ROWTYPE;
  v_net_qty NUMERIC(12,2);
BEGIN
  SELECT * INTO v_sil FROM sell_in_lines  WHERE id = NEW.sell_in_line_id;
  SELECT * INTO v_sio FROM sell_in_orders WHERE id = v_sil.sell_in_order_id;

  -- Only handle purchase lines, skip return-type lines
  IF v_sil.invoice_type IS NOT NULL AND v_sil.invoice_type <> 'purchase' THEN
    RETURN NEW;
  END IF;

  -- Bug 6: net qty = gross arrived minus units returned to supplier at delivery
  -- Recompute from ALL arrived lines for this sell_in_line (Bug 13 fix)
  SELECT GREATEST(0,
    COALESCE(SUM(arrived_qty), 0) - COALESCE(SUM(returned_qty), 0)
  )
  INTO v_net_qty
  FROM sell_in_arrived_lines
  WHERE sell_in_line_id = NEW.sell_in_line_id;

  IF v_net_qty > 0 THEN
    INSERT INTO fifo_batch_ledger (
      tenant_id, sell_in_order_id, sell_in_line_id, sell_in_arrived_id,
      product_id, purchase_date, po_no, arrived_qty, rate, consumed_qty
    ) VALUES (
      v_sio.tenant_id,
      v_sio.id,
      v_sil.id,
      NEW.id,
      v_sil.product_id,
      v_sio.transaction_date,
      v_sio.po_no,
      v_net_qty,
      COALESCE(v_sil.rate, 0),
      0
    )
    ON CONFLICT (sell_in_line_id) DO UPDATE SET
      sell_in_arrived_id = NEW.id,
      -- Bug 13: always recompute total net qty from all arrived lines
      arrived_qty        = v_net_qty,
      rate               = COALESCE(v_sil.rate, 0),
      updated_at         = now();
  ELSE
    -- Net qty dropped to 0 or below (all units returned to supplier):
    -- remove this batch from the ledger so it doesn't pollute FIFO ordering
    DELETE FROM fifo_batch_ledger WHERE sell_in_line_id = NEW.sell_in_line_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fifo_on_sell_in_arrived ON sell_in_arrived_lines;
CREATE TRIGGER trg_fifo_on_sell_in_arrived
  AFTER INSERT OR UPDATE ON sell_in_arrived_lines
  FOR EACH ROW EXECUTE FUNCTION _fifo_on_sell_in_arrived();


-- ============================================================================
-- D2. TRIGGER: sell_in_orders  (on_credit / billed flow)
--
--     Bug 11 fix: orders set to on_credit or billed may skip the
--     sell_in_arrived_lines confirmation step. Stock physically moved,
--     so we must create a batch using the ordered quantity (sil.qty).
--     ON CONFLICT DO NOTHING: if sell_in_arrived_lines trigger already
--     created the batch (stock_arrived path), do not overwrite it.
-- ============================================================================

CREATE OR REPLACE FUNCTION _fifo_on_sell_in_order_confirmed()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Only act when status first enters on_credit or billed from another state
  IF NEW.status NOT IN ('on_credit', 'billed') THEN
    RETURN NEW;
  END IF;
  IF OLD.status IS NOT NULL AND OLD.status IN ('on_credit', 'billed', 'stock_arrived') THEN
    RETURN NEW;  -- already processed
  END IF;

  INSERT INTO fifo_batch_ledger (
    tenant_id, sell_in_order_id, sell_in_line_id,
    product_id, purchase_date, po_no, arrived_qty, rate, consumed_qty
  )
  SELECT
    NEW.tenant_id,
    NEW.id,
    sil.id,
    sil.product_id,
    NEW.transaction_date,
    NEW.po_no,
    sil.qty,                        -- ordered qty (no arrival record exists)
    COALESCE(sil.rate, 0),
    0
  FROM sell_in_lines sil
  WHERE sil.sell_in_order_id = NEW.id
    AND (sil.invoice_type IS NULL OR sil.invoice_type = 'purchase')
    AND sil.qty > 0
  ON CONFLICT (sell_in_line_id) DO NOTHING;
  -- DO NOTHING: sell_in_arrived_lines trigger has priority if it already ran

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fifo_on_sell_in_order_confirmed ON sell_in_orders;
CREATE TRIGGER trg_fifo_on_sell_in_order_confirmed
  AFTER UPDATE OF status ON sell_in_orders
  FOR EACH ROW EXECUTE FUNCTION _fifo_on_sell_in_order_confirmed();


-- ============================================================================
-- E. _fifo_net_out_at(p_tenant_id, p_cutoff_date)
--
--    Shared helper: returns net OUT quantity per product up to and including
--    p_cutoff_date. Combines all three OUT sources via UNION ALL so no
--    source can shadow another (Bug 2 fix).
--
--    Sources:
--      + invoice_line_items  (sales, delivered, not cancelled)
--      + damaged_stock       (status = 'adjusted')
--      − invoice_returns     (non-RGB returns restore stock)
--
--    GREATEST(0,...): floors net_out at 0. Negative net (returns exceed
--    all-time sales) would mean stock appeared from outside the batch ledger
--    — a data-integrity issue, not a code path to support.
-- ============================================================================

CREATE OR REPLACE FUNCTION _fifo_net_out_at(
  p_tenant_id   UUID,
  p_cutoff_date DATE
)
RETURNS TABLE (product_id UUID, qty_out NUMERIC)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    product_id,
    GREATEST(0, SUM(qty)) AS qty_out
  FROM (
    -- Invoice sales
    SELECT ili.product_id, ili.quantity::NUMERIC AS qty
    FROM invoice_line_items ili
    JOIN invoices inv ON inv.id = ili.invoice_id
    WHERE ili.tenant_id    = p_tenant_id
      AND inv.invoice_date <= p_cutoff_date
      AND (inv.delivery_status IS NULL OR inv.delivery_status <> 'cancelled')

    UNION ALL

    -- Adjusted damage (permanently writes off stock)
    SELECT px.id AS product_id, ds.quantity::NUMERIC AS qty
    FROM damaged_stock ds
    JOIN products px
      ON px.tenant_id = ds.tenant_id
      AND LOWER(TRIM(px.product_name)) = LOWER(TRIM(ds.product_name))
    WHERE ds.tenant_id     = p_tenant_id
      AND ds.status         = 'adjusted'
      AND ds.recorded_date <= p_cutoff_date

    UNION ALL

    -- Non-RGB shop returns (stock restored → negative contribution to OUT)
    -- is_returnable = FALSE means a regular FMCG product (not an empty/bottle)
    SELECT px.id AS product_id, -ir.returned_qty::NUMERIC AS qty
    FROM invoice_returns ir
    JOIN products px
      ON px.tenant_id = ir.tenant_id
      AND LOWER(TRIM(px.product_name)) = LOWER(TRIM(ir.product_name))
    JOIN product_categories pc ON pc.id = px.category_id
    WHERE ir.tenant_id    = p_tenant_id
      AND pc.is_returnable = FALSE
      AND ir.return_date  <= p_cutoff_date
  ) src
  GROUP BY product_id;
$$;


-- ============================================================================
-- F. fifo_batch_remaining  VIEW  (always live — no stale state)
--
--    Bug 1 fix: does NOT read fifo_batch_ledger.consumed_qty.
--    Bug 5 fix: correct FIFO formula using cum_prev.
--    Bug 10 fix: consistent ORDER BY purchase_date, created_at, id.
--
--    FIFO formula (proved correct for all edge cases):
--      cum_prev          = SUM(arrived_qty for all OLDER batches of same product)
--      consumed_in_batch = MAX(0, MIN(arrived_qty, MAX(0, total_out - cum_prev)))
--      remaining         = arrived_qty - consumed_in_batch
--
--    Uses security_invoker so RLS on all base tables applies automatically.
-- ============================================================================

DROP VIEW IF EXISTS fifo_batch_remaining CASCADE;
CREATE OR REPLACE VIEW fifo_batch_remaining
  WITH (security_invoker = TRUE) AS
WITH

-- Aggregate all OUT sources without a date filter (view = current state)
raw_outs AS (
  SELECT ili.tenant_id, ili.product_id, ili.quantity::NUMERIC AS qty
  FROM invoice_line_items ili
  JOIN invoices inv ON inv.id = ili.invoice_id
  WHERE (inv.delivery_status IS NULL OR inv.delivery_status <> 'cancelled')

  UNION ALL

  SELECT ds.tenant_id, px.id AS product_id, ds.quantity::NUMERIC AS qty
  FROM damaged_stock ds
  JOIN products px ON px.tenant_id = ds.tenant_id
    AND LOWER(TRIM(px.product_name)) = LOWER(TRIM(ds.product_name))
  WHERE ds.status = 'adjusted'

  UNION ALL

  SELECT ir.tenant_id, px.id AS product_id, -ir.returned_qty::NUMERIC AS qty
  FROM invoice_returns ir
  JOIN products px ON px.tenant_id = ir.tenant_id
    AND LOWER(TRIM(px.product_name)) = LOWER(TRIM(ir.product_name))
  JOIN product_categories pc ON pc.id = px.category_id
  WHERE pc.is_returnable = FALSE
),

net_out AS (
  SELECT tenant_id, product_id, GREATEST(0, SUM(qty)) AS qty_out
  FROM raw_outs
  GROUP BY tenant_id, product_id
),

-- Bug 10: ORDER BY purchase_date ASC, created_at ASC, id ASC (consistent tiebreaker)
batches_with_cum_prev AS (
  SELECT
    fbl.tenant_id,
    fbl.id            AS batch_id,
    fbl.product_id,
    fbl.purchase_date,
    fbl.po_no,
    fbl.arrived_qty,
    fbl.rate,
    fbl.batch_value,
    -- cum_prev: total arrived in ALL batches BEFORE this one (same tenant+product)
    -- ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING returns NULL for first row
    COALESCE(
      SUM(fbl.arrived_qty) OVER (
        PARTITION BY fbl.tenant_id, fbl.product_id
        ORDER BY fbl.purchase_date ASC, fbl.created_at ASC, fbl.id ASC
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      ), 0
    ) AS cum_prev
  FROM fifo_batch_ledger fbl
),

fifo_computed AS (
  SELECT
    b.tenant_id,
    b.batch_id,
    b.product_id,
    b.purchase_date,
    b.po_no,
    b.arrived_qty,
    b.rate,
    b.batch_value,
    -- Bug 5: correct FIFO consumed formula
    GREATEST(0,
      LEAST(b.arrived_qty,
            GREATEST(0, COALESCE(no_.qty_out, 0) - b.cum_prev)
      )
    )                                                   AS consumed_in_batch,
    b.arrived_qty - GREATEST(0,
      LEAST(b.arrived_qty,
            GREATEST(0, COALESCE(no_.qty_out, 0) - b.cum_prev)
      )
    )                                                   AS live_remaining_qty
  FROM batches_with_cum_prev b
  LEFT JOIN net_out no_
         ON no_.tenant_id  = b.tenant_id
        AND no_.product_id = b.product_id
)

SELECT
  fc.batch_id,
  fc.tenant_id,
  fc.product_id,
  p.product_name,
  fc.purchase_date,
  fc.po_no,
  fc.arrived_qty,
  fc.rate,
  fc.batch_value,
  fc.consumed_in_batch,
  fc.live_remaining_qty                  AS remaining_qty,
  fc.live_remaining_qty * fc.rate        AS remaining_value
FROM fifo_computed fc
JOIN products p ON p.id = fc.product_id
WHERE fc.live_remaining_qty > 0;


-- ============================================================================
-- G. get_fifo_closing_stock(p_as_of_date)
--
--    Returns per-product closing inventory value for the Balance Sheet.
--    closing_value = SUM(remaining_qty_in_batch × batch_own_rate)
--
--    Uses _fifo_net_out_at() for all out-sources (Bug 2 fix).
--    Uses correct FIFO formula with cum_prev (Bug 5 fix).
--    Orders batches consistently: purchase_date ASC, created_at ASC, id ASC.
-- ============================================================================

DROP FUNCTION IF EXISTS get_fifo_closing_stock(DATE);
CREATE OR REPLACE FUNCTION get_fifo_closing_stock(
  p_as_of_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  tenant_id         UUID,
  product_id        UUID,
  product_name      TEXT,
  closing_qty       NUMERIC,
  closing_value     NUMERIC,
  avg_cost_per_unit NUMERIC
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tenant_id UUID;
BEGIN
  v_tenant_id := current_tenant_id();

  RETURN QUERY
  WITH

  -- All batches purchased on or before the reporting date
  batches_cum AS (
    SELECT
      fbl.product_id,
      fbl.id            AS batch_id,
      fbl.arrived_qty,
      fbl.rate,
      COALESCE(
        SUM(fbl.arrived_qty) OVER (
          PARTITION BY fbl.product_id
          ORDER BY fbl.purchase_date ASC, fbl.created_at ASC, fbl.id ASC
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ), 0
      ) AS cum_prev
    FROM fifo_batch_ledger fbl
    WHERE fbl.tenant_id    = v_tenant_id
      AND fbl.purchase_date <= p_as_of_date
  ),

  -- Net outflows up to the reporting date (all sources)
  net_out AS (
    SELECT no_.product_id, no_.qty_out
    FROM _fifo_net_out_at(v_tenant_id, p_as_of_date) no_
  ),

  -- Per-batch remaining: arrived − consumed
  fifo_remaining AS (
    SELECT
      bc.product_id,
      bc.rate,
      bc.arrived_qty - GREATEST(0,
        LEAST(bc.arrived_qty,
              GREATEST(0, COALESCE(tot.qty_out, 0) - bc.cum_prev)
        )
      ) AS remaining_qty_in_batch
    FROM batches_cum bc
    LEFT JOIN net_out tot ON tot.product_id = bc.product_id
  )

  SELECT
    v_tenant_id                                        AS tenant_id,
    fr.product_id,
    p.product_name,
    SUM(fr.remaining_qty_in_batch)::NUMERIC            AS closing_qty,
    SUM(fr.remaining_qty_in_batch * fr.rate)::NUMERIC  AS closing_value,
    CASE
      WHEN SUM(fr.remaining_qty_in_batch) > 0
        THEN ROUND(
               SUM(fr.remaining_qty_in_batch * fr.rate) /
               NULLIF(SUM(fr.remaining_qty_in_batch), 0),
             4)
      ELSE 0
    END::NUMERIC                                       AS avg_cost_per_unit
  FROM fifo_remaining fr
  JOIN products p ON p.id = fr.product_id AND p.tenant_id = v_tenant_id
  WHERE fr.remaining_qty_in_batch > 0
  GROUP BY fr.product_id, p.product_name
  ORDER BY p.product_name;
END;
$$;

GRANT EXECUTE ON FUNCTION get_fifo_closing_stock(DATE) TO authenticated;


-- ============================================================================
-- H. get_fifo_cogs(p_date_from, p_date_to)
--
--    Period COGS = FIFO cumulative cost at p_date_to
--                 minus FIFO cumulative cost at (p_date_from − 1)
--
--    Bug 8 fix: returns RAW delta (not clamped to 0).
--    Negative cogs_value means net returns exceeded net sales in the period
--    (a return credit that restores inventory value). This is the only way
--    the accounting identity always holds.
--    Application layer should display MAX(0, cogs_value) on P&L and handle
--    negative values as a separate "Return Credits" line if needed.
--
--    units_sold column is informational (invoice sales only, not the cost driver).
-- ============================================================================

DROP FUNCTION IF EXISTS get_fifo_cogs(DATE, DATE);
CREATE OR REPLACE FUNCTION get_fifo_cogs(
  p_date_from DATE DEFAULT DATE_TRUNC('month', CURRENT_DATE)::DATE,
  p_date_to   DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  tenant_id    UUID,
  product_id   UUID,
  product_name TEXT,
  units_sold   NUMERIC,   -- invoice sales only (for display)
  cogs_value   NUMERIC    -- raw FIFO cost delta; may be negative (return credit)
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tenant_id    UUID;
  v_start_cutoff DATE;
BEGIN
  v_tenant_id    := current_tenant_id();
  -- Bug 4 fix: (DATE - INTEGER) returns DATE, not TIMESTAMP
  v_start_cutoff := (p_date_from - 1)::DATE;

  RETURN QUERY
  WITH

  -- Cumulative net outflows at start (day before period opens)
  out_start AS (
    SELECT no_.product_id, no_.qty_out
    FROM _fifo_net_out_at(v_tenant_id, v_start_cutoff) no_
  ),

  -- Cumulative net outflows at end of period
  out_end AS (
    SELECT no_.product_id, no_.qty_out
    FROM _fifo_net_out_at(v_tenant_id, p_date_to) no_
  ),

  -- FIFO cumulative cost consumed at start of period
  -- Batches: purchase_date <= v_start_cutoff
  -- Consumption: out_start
  cost_at_start AS (
    SELECT
      b.product_id,
      SUM(
        GREATEST(0,
          LEAST(b.arrived_qty,
                GREATEST(0, COALESCE(os.qty_out, 0) - b.cum_prev)
          )
        ) * b.rate
      ) AS fifo_cost
    FROM (
      SELECT
        fbl.product_id,
        fbl.arrived_qty,
        fbl.rate,
        COALESCE(
          SUM(fbl.arrived_qty) OVER (
            PARTITION BY fbl.product_id
            ORDER BY fbl.purchase_date ASC, fbl.created_at ASC, fbl.id ASC
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ), 0
        ) AS cum_prev
      FROM fifo_batch_ledger fbl
      WHERE fbl.tenant_id    = v_tenant_id
        AND fbl.purchase_date <= v_start_cutoff
    ) b
    LEFT JOIN out_start os ON os.product_id = b.product_id
    GROUP BY b.product_id
  ),

  -- FIFO cumulative cost consumed at end of period
  -- Batches: purchase_date <= p_date_to
  -- Consumption: out_end
  cost_at_end AS (
    SELECT
      b.product_id,
      SUM(
        GREATEST(0,
          LEAST(b.arrived_qty,
                GREATEST(0, COALESCE(oe.qty_out, 0) - b.cum_prev)
          )
        ) * b.rate
      ) AS fifo_cost
    FROM (
      SELECT
        fbl.product_id,
        fbl.arrived_qty,
        fbl.rate,
        COALESCE(
          SUM(fbl.arrived_qty) OVER (
            PARTITION BY fbl.product_id
            ORDER BY fbl.purchase_date ASC, fbl.created_at ASC, fbl.id ASC
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ), 0
        ) AS cum_prev
      FROM fifo_batch_ledger fbl
      WHERE fbl.tenant_id    = v_tenant_id
        AND fbl.purchase_date <= p_date_to
    ) b
    LEFT JOIN out_end oe ON oe.product_id = b.product_id
    GROUP BY b.product_id
  ),

  -- Invoice units sold in period (informational column only)
  units_in_period AS (
    SELECT ili.product_id, SUM(ili.quantity) AS units_sold
    FROM invoice_line_items ili
    JOIN invoices inv ON inv.id = ili.invoice_id
    WHERE ili.tenant_id    = v_tenant_id
      AND inv.invoice_date  BETWEEN p_date_from AND p_date_to
      AND (inv.delivery_status IS NULL OR inv.delivery_status <> 'cancelled')
    GROUP BY ili.product_id
  ),

  -- All products with any FIFO cost at either snapshot, or any sales
  -- Bug 3 fix: not limited to products with units_sold > 0
  all_products AS (
    SELECT product_id FROM cost_at_end   WHERE fifo_cost > 0  UNION
    SELECT product_id FROM cost_at_start WHERE fifo_cost > 0  UNION
    SELECT product_id FROM units_in_period
  )

  SELECT
    v_tenant_id                                             AS tenant_id,
    p.id                                                    AS product_id,
    p.product_name,
    COALESCE(uip.units_sold, 0)::NUMERIC                    AS units_sold,
    -- Bug 8 fix: RAW delta (may be negative = return credit period)
    -- Mathematically required for accounting identity to hold.
    (COALESCE(ce.fifo_cost, 0) - COALESCE(cs.fifo_cost, 0))::NUMERIC AS cogs_value
  FROM all_products ap
  JOIN products p    ON p.id = ap.product_id AND p.tenant_id = v_tenant_id
  LEFT JOIN cost_at_start cs  ON cs.product_id  = ap.product_id
  LEFT JOIN cost_at_end   ce  ON ce.product_id  = ap.product_id
  LEFT JOIN units_in_period uip ON uip.product_id = ap.product_id
  -- Only return products where cost actually changed in the period
  WHERE (COALESCE(ce.fifo_cost, 0) - COALESCE(cs.fifo_cost, 0)) <> 0
  ORDER BY p.product_name;
END;
$$;

GRANT EXECUTE ON FUNCTION get_fifo_cogs(DATE, DATE) TO authenticated;


-- ============================================================================
-- I. validate_stock_equation(p_date_from, p_date_to)
--
--    Per-SKU: Opening + Purchases = COGS + Closing
--
--    This equation is MATHEMATICALLY GUARANTEED to hold (see proof at top).
--    If is_balanced = FALSE, it always indicates a data-integrity problem
--    (e.g., invoices without corresponding purchase batches, or batch data
--    that predates the migration without being backfilled).
--
--    Bug 4 fix: uses (p_date_from - 1)::DATE.
-- ============================================================================

DROP FUNCTION IF EXISTS validate_stock_equation(DATE, DATE);
CREATE OR REPLACE FUNCTION validate_stock_equation(
  p_date_from DATE DEFAULT DATE_TRUNC('month', CURRENT_DATE)::DATE,
  p_date_to   DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  product_id          UUID,
  product_name        TEXT,
  opening_stock_value NUMERIC,
  purchases_value     NUMERIC,
  cogs_value          NUMERIC,
  closing_stock_value NUMERIC,
  equation_lhs        NUMERIC,
  equation_rhs        NUMERIC,
  discrepancy         NUMERIC,
  is_balanced         BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tenant_id  UUID;
  v_day_before DATE;
BEGIN
  v_tenant_id  := current_tenant_id();
  v_day_before := (p_date_from - 1)::DATE;   -- Bug 4 fix

  RETURN QUERY
  WITH

  -- Opening = closing stock at the last day before the period
  opening AS (
    SELECT cs.product_id, cs.closing_value AS opening_value
    FROM get_fifo_closing_stock(v_day_before) cs
    WHERE cs.tenant_id = v_tenant_id
  ),

  -- Closing = closing stock at the end of the period
  closing AS (
    SELECT cs.product_id, cs.closing_value
    FROM get_fifo_closing_stock(p_date_to) cs
    WHERE cs.tenant_id = v_tenant_id
  ),

  -- Purchases = sum of batch_value for batches arriving in period
  purchases AS (
    SELECT fbl.product_id, SUM(fbl.batch_value) AS purchases_value
    FROM fifo_batch_ledger fbl
    WHERE fbl.tenant_id     = v_tenant_id
      AND fbl.purchase_date BETWEEN p_date_from AND p_date_to
    GROUP BY fbl.product_id
  ),

  -- COGS from the FIFO engine (raw delta — may be negative)
  cogs AS (
    SELECT fc.product_id, fc.cogs_value
    FROM get_fifo_cogs(p_date_from, p_date_to) fc
    WHERE fc.tenant_id = v_tenant_id
  ),

  all_products AS (
    SELECT product_id FROM opening   UNION
    SELECT product_id FROM closing   UNION
    SELECT product_id FROM purchases UNION
    SELECT product_id FROM cogs
  )

  SELECT
    ap.product_id,
    p.product_name,
    COALESCE(o.opening_value,    0)::NUMERIC AS opening_stock_value,
    COALESCE(pur.purchases_value,0)::NUMERIC AS purchases_value,
    COALESCE(c.cogs_value,       0)::NUMERIC AS cogs_value,
    COALESCE(cl.closing_value,   0)::NUMERIC AS closing_stock_value,
    (COALESCE(o.opening_value,0) + COALESCE(pur.purchases_value,0))::NUMERIC AS equation_lhs,
    (COALESCE(c.cogs_value,0)  + COALESCE(cl.closing_value,   0))::NUMERIC   AS equation_rhs,
    (
       (COALESCE(o.opening_value,0) + COALESCE(pur.purchases_value,0))
      -(COALESCE(c.cogs_value,0)   + COALESCE(cl.closing_value,   0))
    )::NUMERIC AS discrepancy,
    -- Tolerance ±0.01 covers NUMERIC rounding across large aggregations
    (ABS(
        (COALESCE(o.opening_value,0) + COALESCE(pur.purchases_value,0))
       -(COALESCE(c.cogs_value,0)   + COALESCE(cl.closing_value,   0))
    ) <= 0.01) AS is_balanced
  FROM all_products ap
  JOIN products p ON p.id = ap.product_id AND p.tenant_id = v_tenant_id
  LEFT JOIN opening   o   ON o.product_id   = ap.product_id
  LEFT JOIN closing   cl  ON cl.product_id  = ap.product_id
  LEFT JOIN purchases pur ON pur.product_id = ap.product_id
  LEFT JOIN cogs      c   ON c.product_id   = ap.product_id
  ORDER BY p.product_name;
END;
$$;

GRANT EXECUTE ON FUNCTION validate_stock_equation(DATE, DATE) TO authenticated;


-- ============================================================================
-- J. assert_stock_equation_balanced(p_date_from, p_date_to)
--
--    Call this before rendering any Income Statement or Balance Sheet.
--    Raises EXCEPTION listing all unbalanced SKUs with their discrepancy.
--    An exception here always means corrupt/missing batch data,
--    NOT a code bug (the math guarantees balance for clean data).
-- ============================================================================

DROP FUNCTION IF EXISTS assert_stock_equation_balanced(DATE, DATE);
CREATE OR REPLACE FUNCTION assert_stock_equation_balanced(
  p_date_from DATE DEFAULT DATE_TRUNC('month', CURRENT_DATE)::DATE,
  p_date_to   DATE DEFAULT CURRENT_DATE
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_bad_skus TEXT;
BEGIN
  SELECT STRING_AGG(
    product_name || ' (discrepancy: Rs.' || ROUND(ABS(discrepancy), 2)::TEXT || ')',
    ', '
    ORDER BY product_name
  )
  INTO v_bad_skus
  FROM validate_stock_equation(p_date_from, p_date_to)
  WHERE NOT is_balanced;

  IF v_bad_skus IS NOT NULL THEN
    RAISE EXCEPTION
      'Stock equation unbalanced for % → %. Affected: [%]. '
      'This means purchase batches are missing or quantities mismatch. '
      'Run: SELECT * FROM validate_stock_equation(''%'', ''%'') WHERE NOT is_balanced;',
      p_date_from, p_date_to, v_bad_skus, p_date_from, p_date_to;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION assert_stock_equation_balanced(DATE, DATE) TO authenticated;


-- ============================================================================
-- K. BALANCE SHEET VIEW — inventory_balance_sheet_line
--
--    Single authoritative source for the Inventory line.
--    For a pinned reporting date, call get_fifo_closing_stock(date) directly.
-- ============================================================================

DROP VIEW IF EXISTS inventory_balance_sheet_line CASCADE;
CREATE OR REPLACE VIEW inventory_balance_sheet_line
  WITH (security_invoker = TRUE) AS
SELECT
  cs.tenant_id,
  cs.product_id,
  cs.product_name,
  cs.closing_qty,
  cs.closing_value     AS inventory_value,
  cs.avg_cost_per_unit
FROM get_fifo_closing_stock(CURRENT_DATE) cs;


-- ============================================================================
-- L. VERIFIED TEST CASES
--
-- All traces use the corrected formula:
--   cum_prev = SUM(arrived for older batches)
--   consumed = MAX(0, MIN(arrived, MAX(0, total_out − cum_prev)))
--   remaining = arrived − consumed
--
-- ═══ T1: Your original bug example ═══
--   Batch A: 200 @ 905  cum_prev=0
--   Batch B: 500 @ 906  cum_prev=200
--   total_out=450 (invoiced, delivered)
--
--   A: consumed=MAX(0,MIN(200,MAX(0,450-0)))=200   remaining=0
--   B: consumed=MAX(0,MIN(500,MAX(0,450-200)))=250 remaining=250
--
--   closing_qty=250  closing_value=250×906=226,500
--   cogs=200×905+250×906=181,000+226,500=407,500
--   equation: 181,000+453,000 = 407,500+226,500 = 634,000 ✓
--
-- ═══ T2: 3 batches — out exhausted before last (proves Bug 5 fix) ═══
--   A=200@905 cum_prev=0, B=500@906 cum_prev=200, C=100@910 cum_prev=700
--   total_out=450
--
--   A: consumed=200  remaining=0
--   B: consumed=250  remaining=250
--   C: consumed=MAX(0,MIN(100,MAX(0,450-700)))=MAX(0,MIN(100,0))=0  remaining=100 ✓
--
--   closing=250×906+100×910=226,500+91,000=317,500
--   (v2/v3 formula: returned 0 for C → 226,500: understated by 91,000)
--
-- ═══ T3: Damage-only, no sales (proves Bug 2+3 fix) ═══
--   Batch A: 200@905 (pre-period, opening=181,000)
--   Damage: 10 units adjusted in period
--   _fifo_net_out_at sees damage → qty_out=10
--
--   closing: consumed=10, remaining=190, value=190×905=171,950
--   cogs: cost_at_end=10×905=9,050 − cost_at_start=0 → 9,050
--   equation: 181,000+0=9,050+171,950=181,000 ✓
--
-- ═══ T4: Net returns exceed sales in period (proves Bug 8 fix) ═══
--   Pre-period: 150 sold (total_out_at_start=150)
--   Batch A: 200@905 (pre-period)
--   Period: 50 returns (non-RGB), 0 sales, 0 purchases
--   total_out_at_end=GREATEST(0,150-50)=100
--
--   opening=closing(start)=(200-150)×905=50×905=45,250
--   closing=closing(end)=(200-100)×905=100×905=90,500
--   cogs=cost_at_end(100×905)−cost_at_start(150×905)=90,500−135,750=−45,250
--   equation: 45,250+0=−45,250+90,500=45,250 ✓
--
--   With GREATEST(0,cogs)=0 (old bug): equation 45,250≠0+90,500 FAILS ✓ fixed
--
-- ═══ T5: Partial supplier return at delivery (proves Bug 6+7 fix) ═══
--   PO: 100 units @ 905, arrived=100, returned_to_supplier=20
--   net arrived in fifo_batch_ledger=80
--   batch_value=80×905=72,400
--   If all sold: cogs=72,400  closing=0
--   equation: 0+72,400=72,400+0=72,400 ✓
--   (v3: stored 100 arrived → batch_value=90,500 → equation fails by 18,100)
--
-- ═══ T6: on_credit order, no arrived_lines (proves Bug 11 fix) ═══
--   Order set to on_credit, 200@905, no sell_in_arrived_lines created
--   trg_fifo_on_sell_in_order_confirmed fires → batch inserted with qty=sil.qty=200
--   Subsequent accounting functions see the batch ✓
--   (v3: batch never inserted → closing stock understated)
-- ============================================================================


-- ============================================================================
-- M. APPLICATION INTEGRATION GUIDE
-- ============================================================================
--
-- Income Statement (P&L):
--   1. Guard before rendering (blocks if data is corrupt):
--        SELECT assert_stock_equation_balanced('2026-07-01', '2026-09-30');
--   2. COGS line (display MAX(0, cogs) — negative means return credit):
--        SELECT product_name,
--               GREATEST(0, cogs_value)    AS cogs,
--               LEAST(0, cogs_value) * -1  AS return_credit
--        FROM get_fifo_cogs('2026-07-01', '2026-09-30');
--
-- Balance Sheet (Inventory):
--   3. Pinned-date inventory:
--        SELECT SUM(closing_value) FROM get_fifo_closing_stock('2026-09-30');
--   4. Today's inventory:
--        SELECT SUM(inventory_value) FROM inventory_balance_sheet_line;
--
-- Batch drill-down (always live, never stale):
--   5. SELECT * FROM fifo_batch_remaining;
--      Shows every open batch: remaining_qty, consumed_in_batch, remaining_value.
--
-- Full reconciliation audit:
--   6. SELECT * FROM validate_stock_equation('2026-07-01', '2026-09-30')
--      WHERE NOT is_balanced;
--      -- Empty result = all SKUs balanced = data is clean.
-- ============================================================================


-- ============================================================================
-- N. FEATURE FLAG
-- ============================================================================

INSERT INTO global_feature_flags (flag_key, label, enabled)
VALUES ('fifo_costing', 'FIFO Costing Engine (v68 r4)', TRUE)
ON CONFLICT (flag_key) DO UPDATE SET label = EXCLUDED.label, enabled = TRUE;


-- ============================================================================
-- END OF MDOS v68 — FIFO Costing Engine (v4 — DEFINITIVE)
-- ============================================================================
