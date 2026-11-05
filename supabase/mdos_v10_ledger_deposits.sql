-- ============================================================================
-- MDOS v10 — Ledger & Deposits Automation
--
-- Goals:
--   Cash invoice delivered      → agency_ledger revenue (grand_total)
--                               → cash_deposits entry (amount = grand_total)
--   Credit invoice delivered    → agency_ledger revenue (amount_received)
--                               → cash_deposits entry (amount = amount_received)
--   Either reverted             → remove ledger + deposit entries
--   Credit amount_received changed (while delivered)
--                               → update ledger + deposit entries
--
-- Key structural change: cash_deposits gains an invoice_id FK so we can
-- find and clean up the auto-created deposit when status is reverted.
-- ============================================================================


-- ============================================================================
-- 1. Add invoice_id to cash_deposits
--    Nullable so manually-added deposits (not tied to an invoice) still work.
-- ============================================================================

alter table cash_deposits
  add column if not exists invoice_id uuid references invoices(id) on delete set null;

-- Index for fast lookup when cleaning up on revert
create index if not exists idx_cash_deposits_invoice_id
  on cash_deposits(invoice_id)
  where invoice_id is not null;


-- ============================================================================
-- 2. Rewrite move_stock_on_delivery()
--
--    Forward (non-delivered → delivered):
--      • Deduct stock
--      • Insert agency_ledger revenue:
--          - Cash:   amount = grand_total (invoice_total - discount + advance_tax)
--          - Credit: amount = amount_received (submitted amount)
--
--    Reversal (delivered → non-delivered):
--      • Restore stock
--      • Delete agency_ledger entry (ref_table='invoices', ref_id=old.id)
--
--    Amount change (credit, stays delivered, amount_received changed):
--      • Update agency_ledger entry amount
-- ============================================================================

create or replace function move_stock_on_delivery()
returns trigger
language plpgsql
security definer
as $$
declare
  v_was_delivered boolean := false;
  v_product       text;
  v_parts         text[];
  v_name          text;
  v_qty           integer;
  v_ledger_amount numeric;
begin
  if tg_op = 'UPDATE' then
    v_was_delivered := (old.delivery_status = 'delivered');
  end if;

  -- -------------------------------------------------------------------------
  -- Case A: Forward delivery (non-delivered → delivered)
  -- -------------------------------------------------------------------------
  if new.delivery_status = 'delivered' and not v_was_delivered then

    -- Deduct stock
    for v_product in
      select btrim(p) from unnest(string_to_array(new.products, ',')) as p
    loop
      if v_product ~* ' x [0-9]+$' then
        v_parts := regexp_split_to_array(v_product, ' [xX] ');
        v_name  := btrim(v_parts[1]);
        v_qty   := btrim(v_parts[2])::integer;
      else
        v_name := btrim(v_product);
        v_qty  := 1;
      end if;

      update warehouse_stock
      set qty_total    = qty_total    - v_qty,
          qty_reserved = qty_reserved - v_qty
      where tenant_id   = new.tenant_id
        and product_name = v_name;
    end loop;

    -- Determine ledger amount by invoice type
    if new.invoice_type = 'cash' then
      v_ledger_amount := new.invoice_total - new.discount_amount + new.advance_tax;
    else
      -- Credit: use what was actually submitted/received
      v_ledger_amount := coalesce(new.amount_received, 0);
    end if;

    -- Post revenue to agency_ledger
    insert into agency_ledger (
      tenant_id, entry_date, description, amount, entry_type, ref_table, ref_id
    ) values (
      new.tenant_id,
      current_date,
      'Invoice Delivered - ' || new.invoice_no,
      v_ledger_amount,
      'revenue',
      'invoices',
      new.id
    );

  -- -------------------------------------------------------------------------
  -- Case B: Reversal (delivered → non-delivered)
  -- -------------------------------------------------------------------------
  elsif new.delivery_status <> 'delivered' and v_was_delivered then

    -- Restore stock
    for v_product in
      select btrim(p) from unnest(string_to_array(old.products, ',')) as p
    loop
      if v_product ~* ' x [0-9]+$' then
        v_parts := regexp_split_to_array(v_product, ' [xX] ');
        v_name  := btrim(v_parts[1]);
        v_qty   := btrim(v_parts[2])::integer;
      else
        v_name := btrim(v_product);
        v_qty  := 1;
      end if;

      update warehouse_stock
      set qty_total    = qty_total    + v_qty,
          qty_reserved = qty_reserved + v_qty
      where tenant_id   = new.tenant_id
        and product_name = v_name;
    end loop;

    -- Remove the ledger revenue entry for this invoice
    delete from agency_ledger
    where ref_table  = 'invoices'
      and ref_id     = old.id
      and entry_type = 'revenue';

  -- -------------------------------------------------------------------------
  -- Case C: Invoice stays delivered but amount_received changed (credit only)
  -- -------------------------------------------------------------------------
  elsif new.delivery_status = 'delivered'
        and v_was_delivered
        and new.invoice_type = 'credit'
        and new.amount_received is distinct from old.amount_received
  then
    update agency_ledger
    set    amount = coalesce(new.amount_received, 0)
    where  ref_table  = 'invoices'
      and  ref_id     = new.id
      and  entry_type = 'revenue';

  end if;

  return new;
end;
$$;

drop trigger if exists trg_move_stock_on_delivery on invoices;
create trigger trg_move_stock_on_delivery
  after update on invoices
  for each row execute function move_stock_on_delivery();


-- ============================================================================
-- 3. Rewrite auto_create_cash_deposit()
--
--    Forward (non-delivered → delivered):
--      • Cash:   insert deposit with amount = grand_total, status = 'pending'
--      • Credit: insert deposit with amount = amount_received, status = 'pending'
--      Both linked via invoice_id for later cleanup.
--
--    Reversal (delivered → non-delivered):
--      • Delete the auto-created deposit linked to this invoice
--        (only if it is still 'pending' — don't delete one already confirmed)
--
--    Amount change (credit, stays delivered, amount_received changed):
--      • Update the linked deposit amount
-- ============================================================================

create or replace function auto_create_cash_deposit()
returns trigger
language plpgsql
security definer
as $$
declare
  v_was_delivered boolean := false;
  v_deposit_amount numeric;
begin
  if tg_op = 'UPDATE' then
    v_was_delivered := (old.delivery_status = 'delivered');
  end if;

  -- -------------------------------------------------------------------------
  -- Case A: Forward delivery
  -- -------------------------------------------------------------------------
  if new.delivery_status = 'delivered' and not v_was_delivered then

    if new.invoice_type = 'cash' then
      v_deposit_amount := new.invoice_total - new.discount_amount + new.advance_tax;
    else
      v_deposit_amount := coalesce(new.amount_received, 0);
    end if;

    insert into cash_deposits (tenant_id, deposit_date, amount, for_date, status, invoice_id)
    values (
      new.tenant_id,
      current_date,
      v_deposit_amount,
      new.scheduled_date,
      'pending',
      new.id
    );

  -- -------------------------------------------------------------------------
  -- Case B: Reversal — remove the auto-created 'pending' deposit
  --   We only remove deposits that are still 'pending'. If the user has already
  --   confirmed the deposit (status = 'deposited'), we leave it and let them
  --   manage it manually.
  -- -------------------------------------------------------------------------
  elsif new.delivery_status <> 'delivered' and v_was_delivered then

    delete from cash_deposits
    where invoice_id = old.id
      and status     = 'pending';

  -- -------------------------------------------------------------------------
  -- Case C: Credit invoice stays delivered, amount_received changed
  -- -------------------------------------------------------------------------
  elsif new.delivery_status = 'delivered'
        and v_was_delivered
        and new.invoice_type = 'credit'
        and new.amount_received is distinct from old.amount_received
  then
    update cash_deposits
    set    amount = coalesce(new.amount_received, 0)
    where  invoice_id = new.id
      and  status     = 'pending';

  end if;

  return new;
end;
$$;

drop trigger if exists trg_auto_create_cash_deposit on invoices;
create trigger trg_auto_create_cash_deposit
  after update on invoices
  for each row execute function auto_create_cash_deposit();


-- ============================================================================
-- END OF v10 PATCH
-- ============================================================================
