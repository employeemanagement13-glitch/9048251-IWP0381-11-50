-- ============================================================================
-- MDOS v14 — Ledger Balance Fix + Damaged Stock → Warehouse Sync
--
-- Run this in your Supabase SQL Editor.
--
-- Fixes:
--   1. Rebuild agency_ledger_with_balance view with stable id-based ordering
--      so the running balance is deterministic regardless of created_at ties.
--   2. Add trigger: when a damaged_stock record is inserted/updated/deleted,
--      recalculate qty_flappy in warehouse_stock for that product.
--   3. Re-apply the deposit trigger fix (idempotent, safe to run again).
-- ============================================================================

-- ============================================================================
-- FIX 1: Rebuild ledger view with id as stable tiebreaker
-- ============================================================================

create or replace view agency_ledger_with_balance
  with (security_invoker = true) as
select
  id, tenant_id, entry_date, description, amount, entry_type, created_at,
  sum(amount) over (
    partition by tenant_id
    order by entry_date, created_at, id  -- id as stable tiebreaker
    rows between unbounded preceding and current row
  ) as balance
from agency_ledger;

-- ============================================================================
-- FIX 2: Trigger to sync damaged_stock → warehouse_stock.qty_flappy
-- ============================================================================

-- Function: recalculate qty_flappy for a given product_name and tenant_id
-- Also deducts qty_total when a damaged entry is marked 'adjusted' (written off).
create or replace function sync_warehouse_flappy()
returns trigger
language plpgsql
security definer
as $$
declare
  v_product      text;
  v_tenant       uuid;
  v_flappy       integer;
  v_qty_delta    integer := 0;
  v_old_adjusted boolean := false;
  v_new_adjusted boolean := false;
begin
  -- Determine affected product / tenant
  if tg_op = 'DELETE' then
    v_product := old.product_name;
    v_tenant  := old.tenant_id;
    v_old_adjusted := (old.status = 'adjusted');
  elsif tg_op = 'INSERT' then
    v_product := new.product_name;
    v_tenant  := new.tenant_id;
    v_new_adjusted := (new.status = 'adjusted');
  else -- UPDATE
    v_product := new.product_name;
    v_tenant  := new.tenant_id;
    v_old_adjusted := (old.status = 'adjusted');
    v_new_adjusted := (new.status = 'adjusted');
  end if;

  -- -----------------------------------------------------------------------
  -- Recalculate qty_flappy = sum of all non-adjusted pending damage qty
  -- -----------------------------------------------------------------------
  select coalesce(sum(quantity), 0)
  into   v_flappy
  from   damaged_stock
  where  tenant_id    = v_tenant
    and  product_name = v_product
    and  status      <> 'adjusted';

  -- -----------------------------------------------------------------------
  -- Calculate qty_total delta based on status transitions
  --
  --   INSERT adjusted         → deduct quantity from total (write-off)
  --   INSERT non-adjusted     → no change to total (still in warehouse as flappy)
  --   UPDATE → adjusted       → deduct quantity (was in stock, now written off)
  --   UPDATE adjusted → other → add back quantity (undo write-off)
  --   DELETE adjusted         → add back quantity (remove the write-off)
  --   DELETE non-adjusted     → no change to total
  -- -----------------------------------------------------------------------
  if tg_op = 'INSERT' and v_new_adjusted then
    v_qty_delta := -new.quantity;   -- deduct

  elsif tg_op = 'UPDATE' then
    if not v_old_adjusted and v_new_adjusted then
      v_qty_delta := -new.quantity; -- transition to adjusted → write off
    elsif v_old_adjusted and not v_new_adjusted then
      v_qty_delta := old.quantity;  -- undo adjusted → restore
    elsif v_old_adjusted and v_new_adjusted and old.quantity <> new.quantity then
      -- quantity changed while staying adjusted → adjust the delta
      v_qty_delta := old.quantity - new.quantity;
    end if;

  elsif tg_op = 'DELETE' and v_old_adjusted then
    v_qty_delta := old.quantity;    -- removing an adjusted entry → restore stock
  end if;

  -- -----------------------------------------------------------------------
  -- Apply updates to warehouse_stock
  -- -----------------------------------------------------------------------
  update warehouse_stock
  set    qty_flappy = v_flappy,
         qty_total  = qty_total + v_qty_delta
  where  tenant_id    = v_tenant
    and  product_name = v_product;

  return coalesce(new, old);
end;
$$;

-- Attach trigger to damaged_stock (fires on insert, update, delete)
drop trigger if exists trg_sync_warehouse_flappy on damaged_stock;
create trigger trg_sync_warehouse_flappy
  after insert or update or delete on damaged_stock
  for each row execute function sync_warehouse_flappy();

-- ============================================================================
-- FIX 3: Re-apply deposit trigger fix (removes the status = 'pending' guard)
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

  -- Case A: Forward delivery → create deposit record
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

  -- Case B: Reversal → remove pending deposit only
  elsif new.delivery_status <> 'delivered' and v_was_delivered then

    delete from cash_deposits
    where invoice_id = old.id
      and status     = 'pending';

  -- Case C: Credit invoice stays delivered, payment amount changed
  --   Update deposit amount regardless of status (pending OR deposited)
  elsif new.delivery_status = 'delivered'
        and v_was_delivered
        and new.invoice_type = 'credit'
        and new.amount_received is distinct from old.amount_received
  then
    update cash_deposits
    set    amount = coalesce(new.amount_received, 0)
    where  invoice_id = new.id;

  end if;

  return new;
end;
$$;

drop trigger if exists trg_auto_create_cash_deposit on invoices;
create trigger trg_auto_create_cash_deposit
  after update on invoices
  for each row execute function auto_create_cash_deposit();

-- ============================================================================
-- Backfill: recalculate qty_flappy for all existing damaged_stock records
-- ============================================================================
update warehouse_stock ws
set qty_flappy = (
  select coalesce(sum(ds.quantity), 0)
  from   damaged_stock ds
  where  ds.tenant_id    = ws.tenant_id
    and  ds.product_name = ws.product_name
    and  ds.status      <> 'adjusted'
);

-- ============================================================================
-- END OF v14 PATCH
-- ============================================================================
