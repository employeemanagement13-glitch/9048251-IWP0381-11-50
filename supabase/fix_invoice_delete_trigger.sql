-- ============================================================================
-- MDOS v8 — FIX: Invoice Delete Trigger
-- Problem: When an undelivered invoice is deleted, reserved stock is not released
-- Solution: Add trigger to release reserved stock on invoice deletion
-- Run this AFTER day2_triggers.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. release_stock_on_invoice_delete()
-- Called AFTER DELETE on invoices. If delivery_status != 'delivered',
-- it decrements qty_reserved in warehouse_stock for each product.
-- ----------------------------------------------------------------------------

create or replace function release_stock_on_invoice_delete()
returns trigger
language plpgsql
security definer
as $$
declare
  v_product text;
  v_parts text[];
  v_name text;
  v_qty integer;
begin
  -- Only release stock if invoice was NOT delivered
  if old.delivery_status != 'delivered' then
    for v_product in
      select btrim(unnest(string_to_array(old.products, ',')))
    loop
      if position('×' in v_product) > 0 then
        v_parts := string_to_array(v_product, '×');
      elsif position(' x ' in lower(v_product)) > 0 then
        v_parts := regexp_split_to_array(v_product, ' [xX] ');
      else
        v_name := btrim(v_product);
        v_qty := 1;
        goto next_product;
      end if;

      v_name := btrim(v_parts[1]);
      v_qty := btrim(v_parts[2])::integer;

      <<next_product>>
      update warehouse_stock
      set qty_reserved = greatest(qty_reserved - v_qty, 0)
      where tenant_id = old.tenant_id
        and product_name = v_name;
    end loop;
  end if;

  return old;
end;
$$;

drop trigger if exists trg_release_stock_on_invoice_delete on invoices;
create trigger trg_release_stock_on_invoice_delete
  after delete on invoices
  for each row execute function release_stock_on_invoice_delete();

-- ============================================================================
-- END OF FIX
-- ============================================================================
