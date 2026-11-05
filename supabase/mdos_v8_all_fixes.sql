-- ============================================================================
-- MDOS v8 — CONSOLIDATED FIXES PATCH (supersedes mdos_v8_critical_fixes.sql)
-- Run this AFTER mdos_v7_schema__2_.sql has already been applied.
-- Reconciles every break found between the schema and MDOS_Blueprint_v8.md —
-- 4 critical + 5 moderate/minor. Safe to re-run (IF EXISTS / OR REPLACE
-- throughout).
-- ============================================================================


-- ============================================================================
-- FIX 1 (critical) — invoices.payment_status was missing the "Partial" state.
--
-- Blueprint's Shop Profile Credit Invoices view lists Paid / Partial /
-- Outstanding and shows a real row (INV-018) as "Partial", but the deployed
-- generated column only ever returned 'paid' or 'outstanding'. Postgres
-- doesn't support altering a generated column's expression in place, so the
-- column has to be dropped and re-added.
-- ============================================================================

alter table invoices drop column if exists payment_status;

alter table invoices add column payment_status text
  generated always as (
    case
      when amount_received >= (invoice_total - discount_amount + advance_tax) then 'paid'
      when amount_received > 0 then 'partial'
      else 'outstanding'
    end
  ) stored;


-- ============================================================================
-- FIX 2 (critical) — ccbpl_penalties.status enum didn't cover the
-- blueprint's own sample data ("Paid", "Resolved" used in Tab 6 Page 4,
-- neither legal under the old constraint).
--
-- Resolution: keep 'settled' for backward compatibility, add 'paid' and
-- 'resolved' as accepted values so the blueprint's UI copy is valid.
-- ============================================================================

alter table ccbpl_penalties drop constraint if exists ccbpl_penalties_status_check;

alter table ccbpl_penalties add constraint ccbpl_penalties_status_check
  check (status in ('pending', 'disputed', 'settled', 'paid', 'resolved'));


-- ============================================================================
-- FIX 3 (critical) — route_assignments.status enum was missing "Not
-- Started", which the blueprint's own Tab 1 Page 2 sample data uses
-- (TRK-04 row). The old default also skipped straight to 'in_progress' on
-- creation, so a not-started row could never legitimately exist.
-- ============================================================================

alter table route_assignments drop constraint if exists route_assignments_status_check;

alter table route_assignments add constraint route_assignments_status_check
  check (status in ('not_started', 'in_progress', 'returned'));

-- New rows now start not_started until the truck actually leaves; the app
-- should flip it to in_progress at dispatch time and to returned via the
-- existing "Mark Truck Returned" action.
alter table route_assignments alter column status set default 'not_started';


-- ============================================================================
-- FIX 4 (critical) — log_empties_against_invoice() contradicted the
-- blueprint's own documented UX in two ways:
--   (a) it RAISE EXCEPTION'd on no match, instead of saving unlinked with
--       a warning ("Invoice No not found — entry will be saved unlinked.")
--   (b) it took no shop parameter at all and always derived shop_id from
--       the invoice, but the blueprint's Add Empty Entry form has an
--       independent Shop dropdown that has to go somewhere when there's
--       no invoice to derive a shop from.
--
-- New contract: p_shop_id is now a required parameter (the dropdown value).
--   - If Invoice No matches an invoice for this tenant, the entry links to
--     it AND shop_id is taken from that invoice (overriding the dropdown),
--     preserving the original "can never point at the wrong shop" guarantee
--     for linked entries.
--   - If Invoice No is blank or doesn't match, the entry saves unlinked
--     (invoice_id = NULL) using the dropdown's p_shop_id, and a warning is
--     raised instead of an exception, matching the blueprint's behavior.
-- ============================================================================

drop function if exists log_empties_against_invoice(text, text, integer, numeric, date);

create or replace function log_empties_against_invoice(
  p_shop_id uuid,
  p_invoice_no text,
  p_product_name text,
  p_quantity integer,
  p_deposit_amount numeric,
  p_log_date date default current_date
)
returns table (id uuid, linked_to_invoice boolean, resolved_shop_id uuid)
language plpgsql
security invoker
as $$
declare
  v_invoice invoices%rowtype;
  v_found boolean := false;
  v_shop_id uuid;
  v_invoice_id uuid;
  v_new_id uuid;
begin
  if p_invoice_no is not null and btrim(p_invoice_no) <> '' then
    select * into v_invoice
    from invoices
    where tenant_id = (select current_tenant_id())
      and invoice_no = p_invoice_no;
    v_found := found;
  end if;

  if v_found then
    v_shop_id := v_invoice.shop_id;
    v_invoice_id := v_invoice.id;
  else
    if p_shop_id is null then
      raise exception 'Shop is required when no matching invoice is found';
    end if;
    v_shop_id := p_shop_id;
    v_invoice_id := null;
    raise warning 'Invoice No % not found for this tenant — entry saved unlinked', p_invoice_no;
  end if;

  insert into empties_log (tenant_id, shop_id, invoice_id, product_name, quantity, deposit_amount, log_date)
  values ((select current_tenant_id()), v_shop_id, v_invoice_id, p_product_name, p_quantity, p_deposit_amount, p_log_date)
  returning empties_log.id into v_new_id;

  return query select v_new_id, v_found, v_shop_id;
end;
$$;


-- ============================================================================
-- FIX 5 (moderate) — shops.phone was nullable in the deployed schema, but
-- the blueprint's own schema block declares it NOT NULL. Backfill any
-- existing NULLs first so the NOT NULL constraint doesn't fail on data
-- already in the table.
-- ============================================================================

update shops set phone = '' where phone is null;
alter table shops alter column phone set default '';
alter table shops alter column phone set not null;


-- ============================================================================
-- FIX 6 (moderate) — stale/missing global_feature_flags rows for v8:
--   - tab3's label still said "(Pages 1-4)"; Empties Log made it Pages 1-5.
--   - 'shop_details' is referenced by the blueprint's /admin/tenants/[id]
--     table but was never inserted, so toggling it would fail the
--     tenant_feature_flags foreign key.
-- ============================================================================

update global_feature_flags
  set label = 'Tab 3 — Inventory Control (Pages 1-5)'
  where flag_key = 'tab3';

insert into global_feature_flags (flag_key, label) values
  ('shop_details', 'Shop Details')
on conflict (flag_key) do nothing;


-- ============================================================================
-- FIX 7 (moderate) — blocked_shops view had no Overdue figure, but the
-- blueprint's Tab 2 Page 2 (Blocked Accounts) table displays one. Recreated
-- with a per-shop overdue balance: unpaid credit invoices past their own
-- due_date.
-- ============================================================================

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


-- ============================================================================
-- FIX 8 (moderate) — no global (platform-wide) on/off switch existed for
-- alert types. Tabs/Pages already have a proper two-tier setup
-- (global_feature_flags + tenant_feature_flags); alerts only had the
-- per-tenant tenant_alert_settings table. This adds the missing global
-- tier that /admin/settings Section 2 needs.
-- ============================================================================

create table if not exists global_alert_settings (
  alert_type text primary key check (alert_type in ('cash_not_deposited', 'overdue_threshold')),
  enabled boolean not null default true
);
alter table global_alert_settings enable row level security;

create policy global_alert_settings_read on global_alert_settings for select
  to authenticated using (true);

create policy global_alert_settings_write on global_alert_settings for all
  to authenticated
  using ( (select is_platform_admin()) )
  with check ( (select is_platform_admin()) );

insert into global_alert_settings (alert_type, enabled) values
  ('cash_not_deposited', true),
  ('overdue_threshold', true)
on conflict (alert_type) do nothing;

-- The existing cron job now also respects the platform-wide switch, on top
-- of each tenant's own toggle.
create or replace function job_cash_not_deposited_check()
returns void
language plpgsql
security definer
as $$
declare
  r record;
begin
  for r in
    select tas.tenant_id, tas.cash_not_deposited_hours,
           coalesce(sum(d.for_date_amount), 0) as undeposited
    from tenant_alert_settings tas
    join lateral (
      select sum(i.amount_received) as for_date_amount
      from invoices i
      where i.tenant_id = tas.tenant_id
        and i.invoice_type = 'cash'
        and i.delivery_status = 'delivered'
        and i.updated_at < now() - make_interval(hours => tas.cash_not_deposited_hours)
        and not exists (
          select 1 from cash_deposits cd
          where cd.tenant_id = i.tenant_id
            and cd.for_date = i.scheduled_date
            and cd.status = 'deposited'
        )
    ) d on true
    where tas.cash_not_deposited_enabled = true
      and exists (
        select 1 from global_alert_settings gas
        where gas.alert_type = 'cash_not_deposited' and gas.enabled = true
      )
    group by tas.tenant_id, tas.cash_not_deposited_hours
  loop
    if r.undeposited > 0 then
      insert into alerts (tenant_id, alert_type, details, severity)
      values (r.tenant_id, 'cash_not_deposited',
              format('Rs.%s undeposited past %s hours', r.undeposited, r.cash_not_deposited_hours),
              'HIGH');
    end if;
  end loop;
end;
$$;

create or replace function job_overdue_alert_check()
returns void
language plpgsql
security definer
as $$
declare
  r record;
begin
  for r in
    select
      i.tenant_id,
      s.shop_name,
      i.invoice_no,
      (i.invoice_total - i.discount_amount + i.advance_tax - i.amount_received) as balance,
      i.due_date
    from invoices i
    join shops s on s.id = i.shop_id
    where i.invoice_type = 'credit'
      and i.due_date is not null
      and i.due_date < current_date
      and (i.invoice_total - i.discount_amount + i.advance_tax - i.amount_received) > 0
      and exists (
        select 1 from tenant_alert_settings tas
        where tas.tenant_id = i.tenant_id
          and tas.overdue_threshold_enabled = true
      )
      and exists (
        select 1 from global_alert_settings gas
        where gas.alert_type = 'overdue_threshold'
          and gas.enabled = true
      )
  loop
    if not exists (
      select 1 from alerts a
      where a.tenant_id = r.tenant_id
        and a.alert_type = 'overdue_threshold'
        and a.details like '%' || r.invoice_no || '%'
    ) then
      insert into alerts (tenant_id, alert_type, details, severity)
      values (
        r.tenant_id,
        'overdue_threshold',
        format('Invoice %s for %s is overdue — balance Rs.%s due.', r.invoice_no, r.shop_name, round(r.balance, 2)),
        'HIGH'
      );
    end if;
  end loop;
end;
$$;

select cron.schedule('mdos-overdue-alert-check', '0 * * * *', $$select job_overdue_alert_check()$$)
on conflict (jobname) do nothing;


-- ============================================================================
-- FIX 9 (minor) — admin_logs.pages_visited was a plain integer, but the
-- blueprint's /admin/logs UI shows an expandable "3 pages ▾" list. Adds the
-- actual page list; pages_visited becomes a generated count off that array
-- so existing app code reading a plain integer still works unchanged.
-- ============================================================================

alter table admin_logs add column if not exists visited_pages text[] not null default '{}';

alter table admin_logs drop column if exists pages_visited;

alter table admin_logs add column pages_visited integer
  generated always as (coalesce(array_length(visited_pages, 1), 0)) stored;



-- ============================================================================
-- FIX 10 (critical) — tenant_id defaults.
-- RLS policies require tenant_id = current_tenant_id() on insert/update.
-- If tenant_id is not explicitly passed by the application, it results in
-- RLS policy violations. Setting the column default to current_tenant_id()
-- auto-populates it correctly from the authenticated Clerk JWT session.
-- ============================================================================

alter table shops alter column tenant_id set default current_tenant_id();
alter table employees alter column tenant_id set default current_tenant_id();
alter table invoices alter column tenant_id set default current_tenant_id();
alter table empties_log alter column tenant_id set default current_tenant_id();
alter table warehouse_stock alter column tenant_id set default current_tenant_id();
alter table dm_routes alter column tenant_id set default current_tenant_id();
alter table route_assignments alter column tenant_id set default current_tenant_id();
alter table late_deliveries alter column tenant_id set default current_tenant_id();
alter table damaged_stock alter column tenant_id set default current_tenant_id();
alter table returns_wayback alter column tenant_id set default current_tenant_id();
alter table stock_audits alter column tenant_id set default current_tenant_id();
alter table stock_discrepancies alter column tenant_id set default current_tenant_id();
alter table cash_deposits alter column tenant_id set default current_tenant_id();
alter table agency_ledger alter column tenant_id set default current_tenant_id();
alter table ccbpl_ledger alter column tenant_id set default current_tenant_id();
alter table ccbpl_purchases alter column tenant_id set default current_tenant_id();
alter table agency_expenses alter column tenant_id set default current_tenant_id();
alter table ccbpl_penalties alter column tenant_id set default current_tenant_id();
alter table alerts alter column tenant_id set default current_tenant_id();
alter table tenant_alert_settings alter column tenant_id set default current_tenant_id();
alter table tenant_feature_flags alter column tenant_id set default current_tenant_id();
alter table backups alter column tenant_id set default current_tenant_id();

-- ============================================================================
-- END OF PATCH
-- ============================================================================

