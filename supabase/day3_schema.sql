-- ============================================================================
-- MDOS — DAY 3 SCHEMA PATCH
-- Run in Supabase SQL Editor AFTER v7 + v8 patches have been applied.
-- Covers:
--   1. returns_wayback — add 'pending' status (Receive -> Approve | Reject flow)
--   2. approve_return_restores_stock() — DB trigger for stock restoration
--   3. credit_shop_aging view — per-invoice aging for Tab 2 and Shop Profile
--   4. pg_trgm indexes — fast partial-text search on outlet_code and shop_name
-- ============================================================================


-- ============================================================================
-- FIX 1 — returns_wayback: allow 'pending' status
-- ============================================================================

alter table returns_wayback
  drop constraint if exists returns_wayback_status_check;

alter table returns_wayback
  add constraint returns_wayback_status_check
  check (status in ('pending', 'approved', 'rejected'));

alter table returns_wayback
  alter column status set default 'pending';


-- ============================================================================
-- FIX 2 — approve_return_restores_stock() trigger
-- Fires AFTER UPDATE. When status transitions TO 'approved', increments
-- warehouse_stock.qty_total. Idempotent — only fires once per transition.
-- ============================================================================

create or replace function approve_return_restores_stock()
returns trigger
language plpgsql
security definer
as $$
declare
  v_was_approved boolean := false;
begin
  if tg_op = 'UPDATE' then
    v_was_approved := (old.status = 'approved');
  end if;

  if new.status = 'approved' and not v_was_approved then
    insert into warehouse_stock (tenant_id, product_name, qty_total)
    values (new.tenant_id, new.product_name, new.received_qty)
    on conflict (tenant_id, product_name)
    do update set qty_total = warehouse_stock.qty_total + excluded.qty_total;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_approve_return_restores_stock on returns_wayback;
create trigger trg_approve_return_restores_stock
  after update on returns_wayback
  for each row execute function approve_return_restores_stock();


-- ============================================================================
-- FIX 3 — credit_shop_aging view
-- Per-invoice aging details for Tab 2 Page 1 and Shop Profile credit view.
-- ============================================================================

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
-- FIX 4 — outlet_code and shop_name partial-text search indexes
-- ============================================================================

create extension if not exists pg_trgm;

create index if not exists idx_shops_outlet_code_trgm
  on shops using gin (outlet_code gin_trgm_ops);

create index if not exists idx_shops_shop_name_trgm
  on shops using gin (shop_name gin_trgm_ops);


-- ============================================================================
-- END OF DAY 3 PATCH
-- ============================================================================
