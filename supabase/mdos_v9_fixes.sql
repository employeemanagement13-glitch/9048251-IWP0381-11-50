-- ============================================================================
-- MDOS v9 Fixes
-- 1. Update invoices.payment_status generation logic
--    (drops dependent views first, recreates them after)
-- 2. Trigger for auto-creating cash_deposits when invoice is marked delivered
-- 3. Modify trg_move_stock_on_delivery to reverse stock/ledger when reverted
-- 4. Enable real-time for business tables
-- ============================================================================


-- ============================================================================
-- 1. Update invoices.payment_status generation logic
--
-- Two views depend on invoices.payment_status:
--   • blocked_shops      (created in mdos_v8_all_fixes.sql FIX 7)
--   • credit_shop_aging  (created in day3_schema.sql FIX 3)
-- Strategy: drop them, alter the column, then recreate them identically.
-- ============================================================================

-- 1a. Drop dependent views
drop view if exists blocked_shops;
drop view if exists credit_shop_aging;

-- 1b. Drop and recreate payment_status with new 'awaiting' state
alter table invoices drop column if exists payment_status;

alter table invoices add column payment_status text
  generated always as (
    case
      when amount_received >= (invoice_total - discount_amount + advance_tax) then 'paid'
      when amount_received > 0                                                then 'partial'
      when delivery_status = 'undispatched'                                   then 'awaiting'
      else 'outstanding'
    end
  ) stored;

-- 1c. Recreate blocked_shops (from mdos_v8_all_fixes.sql FIX 7)
create or replace view blocked_shops
  with (security_invoker = true) as
select
  s.id,
  s.tenant_id,
  s.shop_name,
  s.phone,
  s.block_reason,
  s.blocked_at,
  coalesce((
    select sum(i.invoice_total - i.discount_amount + i.advance_tax - i.amount_received)
    from invoices i
    where i.shop_id = s.id
      and i.invoice_type = 'credit'
      and i.due_date is not null
      and i.due_date < current_date
      and i.payment_status <> 'paid'
  ), 0) as overdue
from shops s
where s.is_blocked = true;

-- 1d. Recreate credit_shop_aging (from day3_schema.sql FIX 3)
create or replace view credit_shop_aging
  with (security_invoker = true) as
select
  i.id                                                          as invoice_id,
  i.tenant_id,
  i.shop_id,
  s.outlet_code,
  s.shop_name,
  i.invoice_no,
  i.invoice_date,
  i.due_date,
  i.scheduled_date,
  i.invoice_total,
  i.discount_amount,
  i.advance_tax,
  i.grand_total,
  i.amount_received,
  i.payment_status,
  i.delivery_status,
  case
    when i.due_date is null then null
    when current_date > i.due_date then (current_date - i.due_date)
    else 0
  end                                                           as aging_days,
  case
    when i.payment_status = 'paid'              then 'paid'
    when i.due_date is null                     then 'no_due_date'
    when current_date <= i.due_date             then '0-30 days'
    when (current_date - i.due_date) <= 30      then 'overdue_1_30'
    when (current_date - i.due_date) <= 60      then 'overdue_31_60'
    else 'overdue_60plus'
  end                                                           as aging_bucket,
  greatest(0, (i.invoice_total - i.discount_amount + i.advance_tax) - i.amount_received)
                                                                as outstanding_balance
from invoices i
join shops s on s.id = i.shop_id
where i.invoice_type = 'credit';


-- ============================================================================
-- 2. Trigger: auto-create cash_deposit record when invoice marked delivered
-- ============================================================================

create or replace function auto_create_cash_deposit()
returns trigger
language plpgsql
security definer
as $$
begin
  -- Only fires when transitioning TO 'delivered' on a cash invoice
  if new.delivery_status = 'delivered'
     and (old.delivery_status is null or old.delivery_status <> 'delivered')
     and new.invoice_type = 'cash'
  then
    insert into cash_deposits (tenant_id, deposit_date, amount, for_date, status)
    values (
      new.tenant_id,
      current_date,
      (new.invoice_total - new.discount_amount + new.advance_tax),
      new.scheduled_date,
      'pending'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_auto_create_cash_deposit on invoices;
create trigger trg_auto_create_cash_deposit
  after update on invoices
  for each row execute function auto_create_cash_deposit();


-- ============================================================================
-- 3. trg_move_stock_on_delivery — add reversal when status reverts from
--    delivered back to pending/undelivered/undispatched.
--    Also fixes the original GOTO usage (not valid PL/pgSQL syntax).
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
begin
  if tg_op = 'UPDATE' then
    v_was_delivered := (old.delivery_status = 'delivered');
  end if;

  -- 3a. Forward: non-delivered → delivered
  if new.delivery_status = 'delivered' and not v_was_delivered then

    for v_product in
      select btrim(p) from unnest(string_to_array(new.products, ',')) as p
    loop
      -- Parse "Product Name x Qty" or "Product Name × Qty"
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

    -- Post revenue to agency_ledger
    insert into agency_ledger (
      tenant_id, entry_date, description, amount, entry_type, ref_table, ref_id
    ) values (
      new.tenant_id,
      current_date,
      'Invoice Delivered - ' || new.invoice_no,
      new.invoice_total - new.discount_amount + new.advance_tax,
      'revenue',
      'invoices',
      new.id
    );

  -- 3b. Reversal: delivered → any other status
  elsif new.delivery_status <> 'delivered' and v_was_delivered then

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

    -- Reverse the revenue entry
    delete from agency_ledger
    where ref_table  = 'invoices'
      and ref_id     = old.id
      and entry_type = 'revenue';

  end if;

  return new;
end;
$$;

drop trigger if exists trg_move_stock_on_delivery on invoices;
create trigger trg_move_stock_on_delivery
  after update on invoices
  for each row execute function move_stock_on_delivery();


-- ============================================================================
-- 4. Enable real-time for business tables
--    (safe to run even if already added — Supabase ignores duplicate adds)
-- ============================================================================

alter publication supabase_realtime add table invoices;
alter publication supabase_realtime add table dm_routes;
alter publication supabase_realtime add table route_assignments;
alter publication supabase_realtime add table cash_deposits;
alter publication supabase_realtime add table agency_ledger;


-- ============================================================================
-- END OF v9 PATCH
-- ============================================================================
