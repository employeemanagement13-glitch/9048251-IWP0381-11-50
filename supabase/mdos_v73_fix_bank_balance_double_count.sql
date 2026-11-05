-- ============================================================================
-- mdos_v73_fix_bank_balance_double_count.sql
--
-- BUG: Deposits (and Billed Sell-In POs paid from a bank account) were counted
-- twice in a Transaction Account's ledger:
--   1. DB triggers incremented/decremented bank_accounts.current_balance
--      (which the ledger uses as the *Opening Balance*), AND
--   2. the bank_account_ledger view lists the same deposit / PO payment as a row.
--
-- FIX: bank_accounts.current_balance is the user-entered OPENING balance only.
-- Movements live in bank_account_ledger. The triggers below no longer touch
-- bank_accounts.current_balance (double-entry ledger_entries are unchanged).
--
-- After running this file, run mdos_v73b_repair_bank_opening_balances.sql ONCE
-- to remove the drift already baked into existing accounts' opening balances.
-- ============================================================================

-- 1. Cash deposits ------------------------------------------------------------
create or replace function sync_bank_balance_on_deposit()
returns trigger
language plpgsql
security definer
as $$
declare
  v_old_deposited boolean := false;
  v_new_deposited boolean := false;
begin
  if tg_op = 'DELETE' then
    v_old_deposited := (old.status = 'deposited');
  elsif tg_op = 'INSERT' then
    v_new_deposited := (new.status = 'deposited');
  else
    v_old_deposited := (old.status = 'deposited');
    v_new_deposited := (new.status = 'deposited');
  end if;

  if tg_op = 'DELETE' then
    delete from ledger_entries where source_table = 'cash_deposits' and source_id = old.id;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if v_new_deposited and new.bank_account_id is not null and new.amount > 0 then
      insert into ledger_entries (tenant_id, account_code, entry_date, debit, credit, source_table, source_id, description)
      values
        (new.tenant_id, 'BANK', new.deposit_date, new.amount, 0, 'cash_deposits', new.id, 'Cash Deposit'),
        (new.tenant_id, 'CASH', new.deposit_date, 0, new.amount, 'cash_deposits', new.id, 'Cash Deposit');
    end if;
    return new;
  end if;

  if not v_old_deposited and v_new_deposited then
    if new.bank_account_id is not null and new.amount > 0 then
      insert into ledger_entries (tenant_id, account_code, entry_date, debit, credit, source_table, source_id, description)
      values
        (new.tenant_id, 'BANK', new.deposit_date, new.amount, 0, 'cash_deposits', new.id, 'Cash Deposit'),
        (new.tenant_id, 'CASH', new.deposit_date, 0, new.amount, 'cash_deposits', new.id, 'Cash Deposit');
    end if;
  elsif v_old_deposited and not v_new_deposited then
    delete from ledger_entries where source_table = 'cash_deposits' and source_id = new.id;
  elsif v_old_deposited and v_new_deposited then
    if new.amount is distinct from old.amount or new.bank_account_id is distinct from old.bank_account_id then
      update ledger_entries set debit = new.amount, entry_date = new.deposit_date
        where source_table = 'cash_deposits' and source_id = new.id and account_code = 'BANK';
      update ledger_entries set credit = new.amount, entry_date = new.deposit_date
        where source_table = 'cash_deposits' and source_id = new.id and account_code = 'CASH';
    end if;
  end if;

  return new;
end;
$$;

-- 2. Billed Sell-In orders ------------------------------------------------------
create or replace function apply_sell_in_status_change()
returns trigger
language plpgsql
security definer
as $$
declare
  v_was_arrived boolean := false;
  v_was_billed  boolean := false;
  v_line record;
  v_total_net numeric(14,2);
begin
  if tg_op = 'UPDATE' then
    v_was_arrived := (old.status in ('stock_arrived','on_credit','billed'));
    v_was_billed  := (old.status = 'billed');
  end if;

  if new.status in ('stock_arrived','on_credit','billed') and not v_was_arrived then
    for v_line in select * from sell_in_lines where sell_in_order_id = new.id loop
      if v_line.invoice_type = 'purchase' then
        update warehouse_stock set qty_total = qty_total + v_line.qty
          where tenant_id = new.tenant_id
            and product_name = (select product_name from products where id = v_line.product_id);
        insert into stock_movements (tenant_id, product_id, movement_date, direction, quantity, amount, source_table, source_id)
        values (new.tenant_id, v_line.product_id, new.transaction_date, 'in', v_line.qty, v_line.net_bill_amount, 'sell_in_lines', v_line.id);
      else
        update warehouse_stock set qty_total = qty_total - v_line.qty
          where tenant_id = new.tenant_id
            and product_name = (select product_name from products where id = v_line.product_id);
        insert into stock_movements (tenant_id, product_id, movement_date, direction, quantity, amount, source_table, source_id)
        values (new.tenant_id, v_line.product_id, new.transaction_date, 'out', v_line.qty, v_line.net_bill_amount, 'sell_in_lines', v_line.id);
      end if;
    end loop;

    select coalesce(sum(case when invoice_type = 'purchase' then net_bill_amount else -net_bill_amount end), 0)
      into v_total_net from sell_in_lines where sell_in_order_id = new.id;

    if v_total_net <> 0 then
      insert into ledger_entries (tenant_id, account_code, entry_date, debit, credit, source_table, source_id, description)
      values
        (new.tenant_id, 'STOCK',     new.transaction_date, greatest(v_total_net,0), greatest(-v_total_net,0), 'sell_in_orders', new.id, 'Sell In - ' || new.po_no || ' - Stock Arrived'),
        (new.tenant_id, 'AP_CCBPL',  new.transaction_date, greatest(-v_total_net,0), greatest(v_total_net,0), 'sell_in_orders', new.id, 'Sell In - ' || new.po_no || ' - Stock Arrived');
    end if;
  end if;

  if new.status = 'billed' and not v_was_billed then
    if new.paid_from_bank_account_id is null then
      raise exception 'paid_from_bank_account_id is required to mark a Sell In order Billed';
    end if;

    select coalesce(sum(case when invoice_type = 'purchase' then net_bill_amount else -net_bill_amount end), 0)
      into v_total_net from sell_in_lines where sell_in_order_id = new.id;

    -- NOTE: bank_accounts.current_balance is intentionally NOT modified here;
    -- the payment appears in bank_account_ledger.

    if v_total_net <> 0 then
      insert into ledger_entries (tenant_id, account_code, entry_date, debit, credit, source_table, source_id, description)
      values
        (new.tenant_id, 'AP_CCBPL', coalesce(new.billed_date, current_date), greatest(v_total_net,0), greatest(-v_total_net,0), 'sell_in_orders', new.id, 'Sell In - ' || new.po_no || ' - Billed'),
        (new.tenant_id, 'BANK',     coalesce(new.billed_date, current_date), greatest(-v_total_net,0), greatest(v_total_net,0), 'sell_in_orders', new.id, 'Sell In - ' || new.po_no || ' - Billed');
    end if;
  end if;

  return new;
end;
$$;
