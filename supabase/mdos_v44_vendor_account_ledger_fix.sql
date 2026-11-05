-- Migration v44: Fix vendor_account_ledger view to properly reflect billed purchase orders and payments

DROP VIEW IF EXISTS vendor_account_ledger;

CREATE VIEW vendor_account_ledger WITH (security_invoker = TRUE) AS

SELECT
  sio.tenant_id,
  sio.vendor_account_id,
  sio.transaction_date                                                AS txn_date,
  ('Sell In-OnCredit-PO-' || sio.po_no)::TEXT                        AS txn_type,
  COALESCE(sio.payment_voucher, '—')                                  AS reference,
  COALESCE((
    SELECT SUM(CASE WHEN sil.invoice_type = 'purchase'
                    THEN COALESCE(sil.bill_amount, sil.net_bill_amount, sil.rate * sil.qty)
                    ELSE -COALESCE(sil.bill_amount, sil.net_bill_amount, sil.rate * sil.qty)
               END)
    FROM sell_in_lines sil
    WHERE sil.sell_in_order_id = sio.id
  ), 0)::NUMERIC(14,2)                                                AS amount_in,
  0::NUMERIC(14,2)                                                    AS amount_out,
  sio.po_no
FROM sell_in_orders sio
WHERE sio.status IN ('on_credit', 'billed')
  AND sio.vendor_account_id IS NOT NULL

UNION ALL

SELECT
  sio.tenant_id,
  sio.vendor_account_id,
  COALESCE(sio.billed_date, sio.transaction_date, sio.created_at::DATE, CURRENT_DATE) AS txn_date,
  ('Sell In-Billed-PO-' || sio.po_no)::TEXT                          AS txn_type,
  COALESCE(sio.payment_voucher, '—')                                  AS reference,
  0::NUMERIC(14,2)                                                    AS amount_in,
  COALESCE(
    CASE 
      WHEN sio.status = 'billed' AND (sio.paid_amount IS NULL OR sio.paid_amount = 0) THEN (
        SELECT SUM(CASE WHEN sil.invoice_type = 'purchase'
                        THEN COALESCE(sil.bill_amount, sil.net_bill_amount, sil.rate * sil.qty)
                        ELSE -COALESCE(sil.bill_amount, sil.net_bill_amount, sil.rate * sil.qty)
                   END)
        FROM sell_in_lines sil
        WHERE sil.sell_in_order_id = sio.id
      )
      ELSE sio.paid_amount
    END,
    0
  )::NUMERIC(14,2)                                                    AS amount_out,
  sio.po_no
FROM sell_in_orders sio
WHERE (COALESCE(sio.paid_amount, 0) > 0 OR sio.status = 'billed')
  AND sio.vendor_account_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
