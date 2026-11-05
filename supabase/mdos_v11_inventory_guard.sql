-- ============================================================================
-- MDOS v11 — Inventory Guard
--
-- Problem: reserve_stock_on_invoice() blindly added to qty_reserved without
-- checking if enough stock was available. Two shops could both reserve more
-- than the total, causing negative Available.
--
-- Fix 1: Rewrite reserve_stock_on_invoice() with availability check.
-- Fix 2: Add trg_update_reserved_on_invoice_edit — when products change on
--         an undelivered invoice, release old reservations then re-reserve new
--         ones (with the same availability check).
-- Fix 3: Rewrite move_stock_on_delivery() to also handle the × separator.
-- ============================================================================


-- ============================================================================
-- 1. reserve_stock_on_invoice() — with availability guard
-- ============================================================================

CREATE OR REPLACE FUNCTION reserve_stock_on_invoice()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_product   TEXT;
  v_parts     TEXT[];
  v_name      TEXT;
  v_qty       INTEGER;
  v_total     INTEGER;
  v_reserved  INTEGER;
  v_flappy    INTEGER;
  v_available INTEGER;
BEGIN
  FOR v_product IN
    SELECT btrim(p) FROM unnest(string_to_array(NEW.products, ',')) AS p
  LOOP
    IF position('x' IN v_product) > 0 AND v_product ~* ' x [0-9]+$' THEN
      v_parts := regexp_split_to_array(v_product, ' [xX] ');
      v_name  := btrim(v_parts[1]);
      v_qty   := btrim(v_parts[2])::integer;
    ELSIF position(chr(215) IN v_product) > 0 THEN
      v_parts := string_to_array(v_product, chr(215));
      v_name  := btrim(v_parts[1]);
      v_qty   := btrim(v_parts[2])::integer;
    ELSE
      v_name := btrim(v_product);
      v_qty  := 1;
    END IF;

    -- Check product exists
    SELECT qty_total, qty_reserved, qty_flappy
    INTO   v_total, v_reserved, v_flappy
    FROM   warehouse_stock
    WHERE  tenant_id    = NEW.tenant_id
      AND  product_name = v_name;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product "%" not found in warehouse stock.', v_name;
    END IF;

    -- Check availability (available = total - reserved - flappy)
    v_available := v_total - v_reserved - v_flappy;
    IF v_qty > v_available THEN
      RAISE EXCEPTION
        'Insufficient stock for "%": ordered %, only % available.',
        v_name, v_qty, v_available;
    END IF;

    -- Reserve
    UPDATE warehouse_stock
    SET    qty_reserved = qty_reserved + v_qty
    WHERE  tenant_id    = NEW.tenant_id
      AND  product_name = v_name;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reserve_stock_on_invoice ON invoices;
CREATE TRIGGER trg_reserve_stock_on_invoice
  AFTER INSERT ON invoices
  FOR EACH ROW EXECUTE FUNCTION reserve_stock_on_invoice();


-- ============================================================================
-- 2. update_reserved_on_invoice_edit() — release old, re-reserve new
--    Fires on UPDATE when products changes and invoice not yet delivered.
-- ============================================================================

CREATE OR REPLACE FUNCTION update_reserved_on_invoice_edit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_product   TEXT;
  v_parts     TEXT[];
  v_name      TEXT;
  v_qty       INTEGER;
  v_total     INTEGER;
  v_reserved  INTEGER;
  v_flappy    INTEGER;
  v_available INTEGER;
BEGIN
  -- Skip if products unchanged or invoice already delivered
  IF NEW.products IS NOT DISTINCT FROM OLD.products THEN
    RETURN NEW;
  END IF;
  IF OLD.delivery_status = 'delivered' THEN
    RETURN NEW;
  END IF;

  -- Step 1: Release OLD reservations
  FOR v_product IN
    SELECT btrim(p) FROM unnest(string_to_array(OLD.products, ',')) AS p
  LOOP
    IF position(chr(215) IN v_product) > 0 THEN
      v_parts := string_to_array(v_product, chr(215));
      v_name  := btrim(v_parts[1]);
      v_qty   := btrim(v_parts[2])::integer;
    ELSIF v_product ~* ' x [0-9]+$' THEN
      v_parts := regexp_split_to_array(v_product, ' [xX] ');
      v_name  := btrim(v_parts[1]);
      v_qty   := btrim(v_parts[2])::integer;
    ELSE
      v_name := btrim(v_product);
      v_qty  := 1;
    END IF;

    UPDATE warehouse_stock
    SET    qty_reserved = GREATEST(qty_reserved - v_qty, 0)
    WHERE  tenant_id    = NEW.tenant_id
      AND  product_name = v_name;
  END LOOP;

  -- Step 2: Re-reserve NEW products with availability check
  FOR v_product IN
    SELECT btrim(p) FROM unnest(string_to_array(NEW.products, ',')) AS p
  LOOP
    IF position(chr(215) IN v_product) > 0 THEN
      v_parts := string_to_array(v_product, chr(215));
      v_name  := btrim(v_parts[1]);
      v_qty   := btrim(v_parts[2])::integer;
    ELSIF v_product ~* ' x [0-9]+$' THEN
      v_parts := regexp_split_to_array(v_product, ' [xX] ');
      v_name  := btrim(v_parts[1]);
      v_qty   := btrim(v_parts[2])::integer;
    ELSE
      v_name := btrim(v_product);
      v_qty  := 1;
    END IF;

    SELECT qty_total, qty_reserved, qty_flappy
    INTO   v_total, v_reserved, v_flappy
    FROM   warehouse_stock
    WHERE  tenant_id    = NEW.tenant_id
      AND  product_name = v_name;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product "%" not found in warehouse stock.', v_name;
    END IF;

    v_available := v_total - v_reserved - v_flappy;
    IF v_qty > v_available THEN
      RAISE EXCEPTION
        'Insufficient stock for "%": ordered %, only % available (after releasing previous reservation).',
        v_name, v_qty, v_available;
    END IF;

    UPDATE warehouse_stock
    SET    qty_reserved = qty_reserved + v_qty
    WHERE  tenant_id    = NEW.tenant_id
      AND  product_name = v_name;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_reserved_on_invoice_edit ON invoices;
CREATE TRIGGER trg_update_reserved_on_invoice_edit
  AFTER UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION update_reserved_on_invoice_edit();


-- ============================================================================
-- 3. Rewrite move_stock_on_delivery() to handle both × and x separators
--    (previous versions only handled " x " pattern, not × unicode)
-- ============================================================================

CREATE OR REPLACE FUNCTION move_stock_on_delivery()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_was_delivered  BOOLEAN := false;
  v_product        TEXT;
  v_parts          TEXT[];
  v_name           TEXT;
  v_qty            INTEGER;
  v_ledger_amount  NUMERIC;
BEGIN
  IF tg_op = 'UPDATE' THEN
    v_was_delivered := (old.delivery_status = 'delivered');
  END IF;

  -- -------------------------------------------------------------------------
  -- Case A: Forward delivery (non-delivered -> delivered)
  -- -------------------------------------------------------------------------
  IF new.delivery_status = 'delivered' AND NOT v_was_delivered THEN

    FOR v_product IN
      SELECT btrim(p) FROM unnest(string_to_array(new.products, ',')) AS p
    LOOP
      IF position(chr(215) IN v_product) > 0 THEN
        v_parts := string_to_array(v_product, chr(215));
        v_name  := btrim(v_parts[1]);
        v_qty   := btrim(v_parts[2])::integer;
      ELSIF v_product ~* ' x [0-9]+$' THEN
        v_parts := regexp_split_to_array(v_product, ' [xX] ');
        v_name  := btrim(v_parts[1]);
        v_qty   := btrim(v_parts[2])::integer;
      ELSE
        v_name := btrim(v_product);
        v_qty  := 1;
      END IF;

      UPDATE warehouse_stock
      SET qty_total    = qty_total    - v_qty,
          qty_reserved = qty_reserved - v_qty
      WHERE tenant_id   = new.tenant_id
        AND product_name = v_name;
    END LOOP;

    IF new.invoice_type = 'cash' THEN
      v_ledger_amount := new.invoice_total - new.discount_amount + new.advance_tax;
    ELSE
      v_ledger_amount := COALESCE(new.amount_received, 0);
    END IF;

    INSERT INTO agency_ledger (
      tenant_id, entry_date, description, amount, entry_type, ref_table, ref_id
    ) VALUES (
      new.tenant_id,
      current_date,
      'Invoice Delivered - ' || new.invoice_no,
      v_ledger_amount,
      'revenue',
      'invoices',
      new.id
    );

  -- -------------------------------------------------------------------------
  -- Case B: Reversal (delivered -> non-delivered) -- restore stock
  -- -------------------------------------------------------------------------
  ELSIF new.delivery_status <> 'delivered' AND v_was_delivered THEN

    FOR v_product IN
      SELECT btrim(p) FROM unnest(string_to_array(old.products, ',')) AS p
    LOOP
      IF position(chr(215) IN v_product) > 0 THEN
        v_parts := string_to_array(v_product, chr(215));
        v_name  := btrim(v_parts[1]);
        v_qty   := btrim(v_parts[2])::integer;
      ELSIF v_product ~* ' x [0-9]+$' THEN
        v_parts := regexp_split_to_array(v_product, ' [xX] ');
        v_name  := btrim(v_parts[1]);
        v_qty   := btrim(v_parts[2])::integer;
      ELSE
        v_name := btrim(v_product);
        v_qty  := 1;
      END IF;

      UPDATE warehouse_stock
      SET qty_total    = qty_total    + v_qty,
          qty_reserved = qty_reserved + v_qty
      WHERE tenant_id   = new.tenant_id
        AND product_name = v_name;
    END LOOP;

    DELETE FROM agency_ledger
    WHERE ref_table  = 'invoices'
      AND ref_id     = old.id
      AND entry_type = 'revenue';

  -- -------------------------------------------------------------------------
  -- Case C: Credit stays delivered, amount_received changed
  -- -------------------------------------------------------------------------
  ELSIF new.delivery_status = 'delivered'
        AND v_was_delivered
        AND new.invoice_type = 'credit'
        AND new.amount_received IS DISTINCT FROM old.amount_received
  THEN
    UPDATE agency_ledger
    SET    amount = COALESCE(new.amount_received, 0)
    WHERE  ref_table  = 'invoices'
      AND  ref_id     = new.id
      AND  entry_type = 'revenue';

  END IF;

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS trg_move_stock_on_delivery ON invoices;
CREATE TRIGGER trg_move_stock_on_delivery
  AFTER UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION move_stock_on_delivery();


-- ============================================================================
-- END OF v11 PATCH
-- Run this in Supabase SQL Editor after deploying the app code changes.
-- ============================================================================
