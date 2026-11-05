DROP VIEW IF EXISTS stock_ledger_with_balance CASCADE;
DROP VIEW IF EXISTS stock_ledger_view CASCADE;

CREATE OR REPLACE VIEW stock_ledger_view WITH (security_invoker = TRUE) AS

SELECT
  sio.tenant_id,
  sio.transaction_date                                             AS date,
  p.product_name,
  p.id                                                             AS product_id,
  'IN'::TEXT                                                       AS direction,
  'Sell In — ' || COALESCE(sio.po_no, 'PO-' || SUBSTRING(sio.id::TEXT, 1, 6)) AS source,
  'sell_in'::TEXT                                                  AS source_type,
  COALESCE(sio.po_no, '')                                          AS source_ref,
  (sal.arrived_qty - COALESCE(sal.returned_qty, 0))                AS qty,
  sal.id                                                           AS event_id,
  sal.created_at                                                   AS event_ts
FROM sell_in_arrived_lines sal
JOIN sell_in_lines  sil ON sil.id  = sal.sell_in_line_id
JOIN sell_in_orders sio ON sio.id  = sil.sell_in_order_id
JOIN products       p   ON p.id    = sil.product_id
WHERE (sio.status IN ('stock_arrived', 'on_credit', 'billed') OR sio.status IS NOT NULL)
  AND (sil.invoice_type IS NULL OR sil.invoice_type = 'purchase')
  AND (sal.arrived_qty - COALESCE(sal.returned_qty, 0)) > 0

UNION ALL

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
WHERE ili.quantity > 0
GROUP BY ili.tenant_id, inv.invoice_date, LOWER(TRIM(p.product_name))

UNION ALL

SELECT
  ds.tenant_id,
  ds.recorded_date                                                 AS date,
  p.product_name,
  p.id                                                             AS product_id,
  'OUT'::TEXT                                                      AS direction,
  'Damaged Stock — ' || COALESCE(NULLIF(ds.webspace_ref, ''), 'DMG-' || UPPER(SUBSTRING(ds.id::TEXT, 1, 6))) AS source,
  'damaged_stock'::TEXT                                            AS source_type,
  COALESCE(ds.webspace_ref, '')                                    AS source_ref,
  ds.quantity                                                      AS qty,
  ds.id                                                            AS event_id,
  ds.created_at                                                    AS event_ts
FROM damaged_stock ds
JOIN products p ON p.tenant_id = ds.tenant_id
  AND LOWER(TRIM(p.product_name)) = LOWER(TRIM(ds.product_name))
WHERE ds.quantity > 0

UNION ALL

SELECT
  ir.tenant_id,
  ir.return_date                                                   AS date,
  MAX(p.product_name)                                              AS product_name,
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
JOIN products p   ON p.tenant_id = ir.tenant_id
  AND LOWER(TRIM(p.product_name)) = LOWER(TRIM(ir.product_name))
WHERE ir.returned_qty > 0
GROUP BY ir.tenant_id, ir.return_date, LOWER(TRIM(p.product_name));


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
