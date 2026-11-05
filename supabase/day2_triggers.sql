-- ============================================================================
-- MDOS v8 — DAY 2 SCHEMA: Stock Triggers for Invoice ↔ Warehouse flow
-- Run in Supabase SQL Editor AFTER v7 base + v8 patch are already applied.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. reserve_stock_on_invoice()
-- Called AFTER INSERT on invoices. Parses the "products" text column
-- (format: "Coke 1.5L×20, Sprite 500ml×10") and increments qty_reserved
-- on warehouse_stock for each product.
-- ----------------------------------------------------------------------------

create or replace function reserve_stock_on_invoice()
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
  for v_product in
    select btrim(unnest(string_to_array(new.products, ',')))
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
    insert into warehouse_stock (tenant_id, product_name, qty_reserved)
    values (new.tenant_id, v_name, v_qty)
    on conflict (tenant_id, product_name)
    do update set qty_reserved = warehouse_stock.qty_reserved + excluded.qty_reserved;
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_reserve_stock_on_invoice on invoices;
create trigger trg_reserve_stock_on_invoice
  after insert on invoices
  for each row execute function reserve_stock_on_invoice();


-- ----------------------------------------------------------------------------
-- 2. move_stock_on_delivery()
-- Called AFTER UPDATE on invoices. When delivery_status flips TO 'delivered'
-- from any other status, it:
--   (a) Decrements qty_total by the delivered quantities
--   (b) Decrements qty_reserved by the same amount
--   (c) Posts revenue to agency_ledger
-- ----------------------------------------------------------------------------

create or replace function move_stock_on_delivery()
returns trigger
language plpgsql
security definer
as $$
declare
  v_was_delivered boolean := false;
  v_product text;
  v_parts text[];
  v_name text;
  v_qty integer;
begin
  if tg_op = 'UPDATE' then
    v_was_delivered := (old.delivery_status = 'delivered');
  end if;

  if new.delivery_status = 'delivered' and not v_was_delivered then
    for v_product in
      select btrim(unnest(string_to_array(new.products, ',')))
    loop
      if position('×' in v_product) > 0 then
        v_parts := string_to_array(v_product, '×');
      elsif position(' x ' in lower(v_product)) > 0 then
        v_parts := regexp_split_to_array(v_product, ' [xX] ');
      else
        v_name := btrim(v_product);
        v_qty := 1;
        goto next_item;
      end if;

      v_name := btrim(v_parts[1]);
      v_qty := btrim(v_parts[2])::integer;

      <<next_item>>
      update warehouse_stock
      set qty_total    = qty_total - v_qty,
          qty_reserved = qty_reserved - v_qty
      where tenant_id = new.tenant_id
        and product_name = v_name;
    end loop;

    -- Post revenue to agency_ledger
    insert into agency_ledger (
      tenant_id, entry_date, description, amount, entry_type, ref_table, ref_id
    ) values (
      new.tenant_id,
      current_date,
      'Invoice Delivered — ' || new.invoice_no,
      new.invoice_total - new.discount_amount + new.advance_tax,
      'revenue',
      'invoices',
      new.id
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_move_stock_on_delivery on invoices;
create trigger trg_move_stock_on_delivery
  after update on invoices
  for each row execute function move_stock_on_delivery();
