-- ============================================================================
-- MDOS v7 — FULL SCHEMA MIGRATION FOR SUPABASE (v2, gap-fixed)
-- Run top to bottom in the Supabase SQL Editor, or as one migration file.
-- Verified against: (1) Postgres's rule that a generated column cannot
-- reference another generated column, (2) Supabase's current (post-April-2025)
-- Clerk Third-Party Auth integration for auth.jwt() claims.
-- v2 changes: added the previously-missing tenant_settings table
-- (auto_assign_enabled), and a trigger that auto-provisions default
-- tenant_settings + tenant_alert_settings rows for every new tenant.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 0. HELPER FUNCTIONS — read Clerk claims out of the JWT
--
-- PREREQUISITE (do this in Clerk, once, before these functions work):
-- Clerk Dashboard → Sessions → Customize session token → add two claims
-- to the token, e.g.:
--   { "tenant_id": "{{user.public_metadata.tenant_id}}",
--     "app_role":  "{{user.public_metadata.app_role}}" }
-- and enable Supabase's native Third-Party Auth integration (Authentication
-- → Sign In / Providers → Clerk) pointing at your Clerk instance. The old
-- "JWT template" method is deprecated — this assumes the current method.
-- ----------------------------------------------------------------------------

create or replace function current_tenant_id()
returns uuid
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'tenant_id', '')::uuid;
$$;

create or replace function is_platform_admin()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'app_role', '') = 'platform_admin';
$$;

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================================
-- 1. TENANTS & ADMIN
-- ============================================================================

create table tenants (
  id uuid primary key default gen_random_uuid(),
  distro_name text not null,
  email text not null,
  phone_number text not null,               -- [RULE 3] mandatory, plain contact field
  access_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_tenants_updated_at before update on tenants
  for each row execute function set_updated_at();

alter table tenants enable row level security;

create policy tenants_select on tenants for select
  to authenticated
  using ( id = (select current_tenant_id()) or (select is_platform_admin()) );

create policy tenants_admin_write on tenants for all
  to authenticated
  using ( (select is_platform_admin()) )
  with check ( (select is_platform_admin()) );

create table admins (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null unique,
  created_at timestamptz not null default now()
);
alter table admins enable row level security;

create policy admins_platform_only on admins for all
  to authenticated
  using ( (select is_platform_admin()) )
  with check ( (select is_platform_admin()) );

-- ============================================================================
-- 2. EMPLOYEES & SHOPS
-- ============================================================================

create table employees (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  full_name text not null,
  role text not null check (role in ('dm','preseller')),
  phone text,
  created_at timestamptz not null default now()
);
create index idx_employees_tenant on employees(tenant_id);
alter table employees enable row level security;

create policy employees_owner_all on employees for all
  to authenticated
  using ( tenant_id = (select current_tenant_id()) )
  with check ( tenant_id = (select current_tenant_id()) );

create table shops (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  outlet_code text not null,                 -- [FINDING 4] permanent identity
  shop_name text not null,
  owner_name text,
  phone text,                                -- plain contact field only, not unique
  shop_type text not null default 'cash' check (shop_type in ('cash','credit')),
  credit_limit numeric(12,2) not null default 0,
  credit_terms_days integer not null default 0,
  is_blocked boolean not null default false,
  block_reason text,
  blocked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint uq_shops_outlet_code unique (tenant_id, outlet_code),  -- [FINDING 4]
  constraint chk_shops_block_reason check (is_blocked = false or block_reason is not null)
);
create index idx_shops_tenant on shops(tenant_id);
alter table shops enable row level security;

create policy shops_owner_all on shops for all
  to authenticated
  using ( tenant_id = (select current_tenant_id()) )
  with check ( tenant_id = (select current_tenant_id()) );

-- Tab 2 Page 2, Blocked Accounts — a view, not a separate table
-- (fixes the duplication in the previous draft, where a standalone
-- blocked_accounts table duplicated shops.is_blocked/block_reason/blocked_at)
create view blocked_shops
  with (security_invoker = true) as
select id, tenant_id, shop_name, phone, block_reason, blocked_at
from shops
where is_blocked = true;

-- ============================================================================
-- 3. INVOICES — [FINDING 9] fixed generated-column chain
-- ============================================================================

create table invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  invoice_no text not null,
  shop_id uuid not null references shops(id) on delete restrict,
  preseller_id uuid references employees(id) on delete set null,
  dm_id uuid references employees(id) on delete set null,
  products text not null,
  promo_type text not null default 'none' check (promo_type in ('in_kind','in_rupees','none')),
  promo_note text,
  invoice_date date not null,
  due_date date,
  scheduled_date date not null,
  invoice_type text not null check (invoice_type in ('cash','credit')),

  invoice_total numeric(12,2) not null,          -- [FINDING 9] renamed from total_amount
  discount_amount numeric(12,2) not null default 0,
  advance_tax numeric(12,2) not null default 0,
  grand_total numeric(12,2)
    generated always as (invoice_total - discount_amount + advance_tax) stored,

  empties_deposit numeric(12,2) not null default 0,   -- [FINDING 5] separate from grand_total

  amount_received numeric(12,2) not null default 0,

  -- FIX: cannot reference grand_total (a generated column) here, so the
  -- same formula is inlined instead — this is the corrected version of the
  -- exact bug flagged earlier.
  payment_status text
    generated always as (
      case when amount_received >= (invoice_total - discount_amount + advance_tax)
           then 'paid' else 'outstanding' end
    ) stored,

  visit_status text check (visit_status in ('visited','unvisited')),
  delivery_status text not null default 'undispatched'
    check (delivery_status in ('undispatched','pending','delivered','undelivered')),
  reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint uq_invoices_invoice_no unique (tenant_id, invoice_no)
);
create index idx_invoices_tenant on invoices(tenant_id);
create index idx_invoices_shop on invoices(shop_id);
create index idx_invoices_dm on invoices(dm_id);
create index idx_invoices_sched_date on invoices(tenant_id, scheduled_date);
create trigger trg_invoices_updated_at before update on invoices
  for each row execute function set_updated_at();

alter table invoices enable row level security;

create policy invoices_owner_all on invoices for all
  to authenticated
  using ( tenant_id = (select current_tenant_id()) )
  with check ( tenant_id = (select current_tenant_id()) );

-- ============================================================================
-- 4. EMPTIES — [FINDING 5]
-- ============================================================================

create table empties_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  shop_id uuid not null references shops(id) on delete restrict,
  invoice_id uuid references invoices(id) on delete set null,
  product_name text not null,
  quantity integer not null check (quantity > 0),
  deposit_amount numeric(12,2) not null default 0,
  log_date date not null default current_date,
  created_at timestamptz not null default now()
);
create index idx_empties_log_tenant on empties_log(tenant_id);
alter table empties_log enable row level security;

create policy empties_log_owner_all on empties_log for all
  to authenticated
  using ( tenant_id = (select current_tenant_id()) )
  with check ( tenant_id = (select current_tenant_id()) );

-- [NEW — Tab 3 Page 5] "Add Empty Entries" matches an existing invoice by
-- invoice_no and links to it. shop_id is derived from that invoice, not
-- typed separately, so an entry can never point at the wrong shop.
create or replace function log_empties_against_invoice(
  p_invoice_no text,
  p_product_name text,
  p_quantity integer,
  p_deposit_amount numeric,
  p_log_date date default current_date
)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_invoice invoices%rowtype;
  v_new_id uuid;
begin
  select * into v_invoice
  from invoices
  where tenant_id = (select current_tenant_id())
    and invoice_no = p_invoice_no;

  if not found then
    raise exception 'No invoice found with Invoice No %', p_invoice_no;
  end if;

  insert into empties_log (tenant_id, shop_id, invoice_id, product_name, quantity, deposit_amount, log_date)
  values (v_invoice.tenant_id, v_invoice.shop_id, v_invoice.id, p_product_name, p_quantity, p_deposit_amount, p_log_date)
  returning id into v_new_id;

  return v_new_id;
end;
$$;

-- Tab 3 Page 5's own summary line ("Total Empties On Hand") — replaces the
-- old warehouse_stock.qty_empties column with a single source of truth.
create view empties_on_hand
  with (security_invoker = true) as
select tenant_id, product_name, sum(quantity) as qty_on_hand, sum(deposit_amount) as deposit_total
from empties_log
group by tenant_id, product_name;

-- ============================================================================
-- 5. WAREHOUSE STOCK
-- ============================================================================

create table warehouse_stock (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  product_name text not null,
  qty_total integer not null default 0,
  qty_reserved integer not null default 0,
  qty_flappy integer not null default 0,
  qty_available integer
    generated always as (qty_total - qty_reserved) stored,
  created_at timestamptz not null default now(),
  constraint uq_warehouse_stock_product unique (tenant_id, product_name)
);
create index idx_warehouse_stock_tenant on warehouse_stock(tenant_id);
alter table warehouse_stock enable row level security;

create policy warehouse_stock_owner_all on warehouse_stock for all
  to authenticated
  using ( tenant_id = (select current_tenant_id()) )
  with check ( tenant_id = (select current_tenant_id()) );

-- ============================================================================
-- 6. ROUTES, ASSIGNMENTS, LATE DELIVERIES
-- ============================================================================

create table dm_routes (                     -- one-time DM/Truck/Route registry
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  dm_id uuid not null references employees(id) on delete cascade,
  truck_no text not null,
  route_name text not null,
  created_at timestamptz not null default now(),
  constraint uq_dm_routes_truck unique (tenant_id, truck_no)
);
alter table dm_routes enable row level security;

create policy dm_routes_owner_all on dm_routes for all
  to authenticated
  using ( tenant_id = (select current_tenant_id()) )
  with check ( tenant_id = (select current_tenant_id()) );

create table route_assignments (             -- daily Tab 1 Page 2 table
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  truck_no text not null,
  dm_id uuid references employees(id) on delete set null,
  route_name text,
  assignment_date date not null,
  status text not null default 'in_progress' check (status in ('in_progress','returned')),
  created_at timestamptz not null default now(),
  constraint uq_route_assignments unique (tenant_id, truck_no, assignment_date)
);
create index idx_route_assignments_tenant on route_assignments(tenant_id, assignment_date);
alter table route_assignments enable row level security;

create policy route_assignments_owner_all on route_assignments for all
  to authenticated
  using ( tenant_id = (select current_tenant_id()) )
  with check ( tenant_id = (select current_tenant_id()) );

create table late_deliveries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  invoice_id uuid not null references invoices(id) on delete cascade,
  days_late integer not null default 0,
  reason text,
  status text not null default 'pending'
    check (status in ('pending','undelivered','resolved','disputed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_late_deliveries_invoice unique (tenant_id, invoice_id),
  -- [FIX] reason now required on Disputed, not on Resolved
  constraint chk_late_deliveries_reason check (status <> 'disputed' or reason is not null)
);
create trigger trg_late_deliveries_updated_at before update on late_deliveries
  for each row execute function set_updated_at();
alter table late_deliveries enable row level security;

create policy late_deliveries_owner_all on late_deliveries for all
  to authenticated
  using ( tenant_id = (select current_tenant_id()) )
  with check ( tenant_id = (select current_tenant_id()) );

-- ============================================================================
-- 7. INVENTORY — Damaged Stock, Returns, Stock Audits, Discrepancies
-- ============================================================================

create table damaged_stock (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  product_name text not null,
  quantity integer not null check (quantity > 0),
  damage_type text,
  batch_no text,
  webspace_ref text,
  status text not null default 'pending'
    check (status in ('pending','complaint_filed','adjusted')),  -- [FIX] dropdown values
  note text,
  recorded_date date not null default current_date,
  created_at timestamptz not null default now()
);
alter table damaged_stock enable row level security;

create policy damaged_stock_owner_all on damaged_stock for all
  to authenticated
  using ( tenant_id = (select current_tenant_id()) )
  with check ( tenant_id = (select current_tenant_id()) );

create table returns_wayback (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  shop_id uuid not null references shops(id) on delete restrict,
  product_name text not null,
  original_invoice_id uuid references invoices(id) on delete set null,
  received_qty integer not null check (received_qty > 0),
  status text not null default 'approved' check (status in ('approved','rejected')),
  reason text,
  return_date date not null default current_date,
  created_at timestamptz not null default now(),
  -- [FIX] reason required only when Rejected
  constraint chk_returns_reason check (status <> 'rejected' or reason is not null)
);
alter table returns_wayback enable row level security;

create policy returns_wayback_owner_all on returns_wayback for all
  to authenticated
  using ( tenant_id = (select current_tenant_id()) )
  with check ( tenant_id = (select current_tenant_id()) );

create table stock_audits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  scheduled_date date not null,
  audit_date date,
  status text not null default 'scheduled'
    check (status in ('scheduled','in_progress','completed')),
  products_counted integer not null default 0,
  created_at timestamptz not null default now()
);
alter table stock_audits enable row level security;

create policy stock_audits_owner_all on stock_audits for all
  to authenticated
  using ( tenant_id = (select current_tenant_id()) )
  with check ( tenant_id = (select current_tenant_id()) );

create table stock_discrepancies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  audit_id uuid references stock_audits(id) on delete set null,
  product_name text not null,
  system_qty integer not null,
  physical_qty integer not null,
  diff integer generated always as (physical_qty - system_qty) stored,
  audit_date date not null default current_date,
  status text not null default 'pending' check (status in ('pending','resolved','disputed')),
  reason text,
  created_at timestamptz not null default now(),
  -- unchanged pattern: reason required on Resolved (this is NOT the alerts table,
  -- and is untouched by the Tab 1 Page 3 reason swap)
  constraint chk_stock_discrepancies_reason check (status <> 'resolved' or reason is not null)
);
alter table stock_discrepancies enable row level security;

create policy stock_discrepancies_owner_all on stock_discrepancies for all
  to authenticated
  using ( tenant_id = (select current_tenant_id()) )
  with check ( tenant_id = (select current_tenant_id()) );

-- ============================================================================
-- 8. CASH DEPOSITS — Tab 4 Page 2
-- ============================================================================

create table cash_deposits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  deposit_date date not null default current_date,
  amount numeric(12,2) not null,
  amount_change_reason text,                 -- [FIX] required only when Amount is edited
  bank_name text,
  bank_ref_no text,
  for_date date not null,
  status text not null default 'pending' check (status in ('pending','deposited')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_cash_deposits_updated_at before update on cash_deposits
  for each row execute function set_updated_at();
alter table cash_deposits enable row level security;

create policy cash_deposits_owner_all on cash_deposits for all
  to authenticated
  using ( tenant_id = (select current_tenant_id()) )
  with check ( tenant_id = (select current_tenant_id()) );

-- ============================================================================
-- 9. CCBPL ACCOUNTS
-- ============================================================================

-- Tab 6 Page 1 — Agency Ledger. Balance is NOT stored (avoids the same
-- generated-column trap fixed above); it's computed live via the view below.
create table agency_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  entry_date date not null default current_date,
  description text not null,
  amount numeric(12,2) not null,             -- positive = revenue in, negative = cost out
  entry_type text not null default 'revenue'
    check (entry_type in ('opening_balance','revenue','purchase_cost','expense','penalty')),
  ref_table text,
  ref_id uuid,
  created_at timestamptz not null default now()
);
create index idx_agency_ledger_tenant on agency_ledger(tenant_id, entry_date);
alter table agency_ledger enable row level security;

create policy agency_ledger_owner_all on agency_ledger for all
  to authenticated
  using ( tenant_id = (select current_tenant_id()) )
  with check ( tenant_id = (select current_tenant_id()) );

create view agency_ledger_with_balance
  with (security_invoker = true) as
select
  id, tenant_id, entry_date, description, amount, entry_type, created_at,
  sum(amount) over (partition by tenant_id order by entry_date, created_at
                     rows between unbounded preceding and current row) as balance
from agency_ledger;

-- Kept per the Blueprint's judgment call: no dedicated page any more,
-- but Purchasing and Penalties still post background entries here.
create table ccbpl_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  entry_date date not null default current_date,
  description text not null,
  ref_no text,
  you_owe numeric(12,2) not null default 0,
  ccbpl_owes numeric(12,2) not null default 0,
  entry_type text not null check (entry_type in ('purchase','deduction','incentive','penalty','payment')),
  ref_table text,
  ref_id uuid,
  created_at timestamptz not null default now()
);
alter table ccbpl_ledger enable row level security;

create policy ccbpl_ledger_owner_all on ccbpl_ledger for all
  to authenticated
  using ( tenant_id = (select current_tenant_id()) )
  with check ( tenant_id = (select current_tenant_id()) );

create table ccbpl_purchases (                -- Tab 6 Page 2 (was Page 3)
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  po_no text not null,
  product_name text not null,
  ordered_qty integer not null,
  received_qty integer,
  billed_amount numeric(12,2),
  status text not null default 'in_progress'
    check (status in ('in_progress','stock_arrived')),
    -- [FIX] 'under_review'/'complaint_submitted' replaced with 'in_progress';
    -- 'closed' dropped — this is now strictly a two-state workflow.
    -- In Progress: zero impact on warehouse_stock or the Agency Ledger.
    -- Stock Arrived: immediately increments both (see trigger below).
  created_at timestamptz not null default now(),
  constraint uq_ccbpl_purchases_po unique (tenant_id, po_no)
);
alter table ccbpl_purchases enable row level security;

create policy ccbpl_purchases_owner_all on ccbpl_purchases for all
  to authenticated
  using ( tenant_id = (select current_tenant_id()) )
  with check ( tenant_id = (select current_tenant_id()) );

-- [NEW] The only place stock or money actually moves for a CCBPL purchase.
-- Fires once, exactly when status flips TO 'stock_arrived' (from any other
-- status, including on first insert) — never again on subsequent edits,
-- so re-saving an already-arrived PO can't double-count.
create or replace function ccbpl_purchase_stock_arrived()
returns trigger
language plpgsql
security definer
as $$
declare
  v_was_arrived boolean := false;
begin
  if tg_op = 'UPDATE' then
    v_was_arrived := (old.status = 'stock_arrived');
  end if;

  if new.status = 'stock_arrived' and not v_was_arrived then
    if new.received_qty is null then
      raise exception 'received_qty must be set before marking a purchase Stock Arrived';
    end if;

    insert into warehouse_stock (tenant_id, product_name, qty_total)
    values (new.tenant_id, new.product_name, new.received_qty)
    on conflict (tenant_id, product_name)
    do update set qty_total = warehouse_stock.qty_total + excluded.qty_total;

    insert into agency_ledger (tenant_id, entry_date, description, amount, entry_type, ref_table, ref_id)
    values (new.tenant_id, current_date, 'CCBPL Purchase — ' || new.po_no,
            -coalesce(new.billed_amount, 0), 'purchase_cost', 'ccbpl_purchases', new.id);
  end if;

  return new;
end;
$$;

create trigger trg_ccbpl_purchase_stock_arrived
  after insert or update on ccbpl_purchases
  for each row execute function ccbpl_purchase_stock_arrived();

create table agency_expenses (                -- Tab 6 Page 3 (was Page 4)
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  expense_date date not null default current_date,
  category text not null,
  description text,
  amount numeric(12,2) not null,
  paid_by text,
  created_at timestamptz not null default now()
);
alter table agency_expenses enable row level security;

create policy agency_expenses_owner_all on agency_expenses for all
  to authenticated
  using ( tenant_id = (select current_tenant_id()) )
  with check ( tenant_id = (select current_tenant_id()) );

create table ccbpl_penalties (                 -- Tab 6 Page 4 (was Page 5)
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  penalty_date date not null default current_date,
  ccbpl_ref text,
  amount numeric(12,2) not null,
  reason text,
  status text not null default 'pending' check (status in ('pending','disputed','settled')),
  dispute_note text,
  created_at timestamptz not null default now()
);
alter table ccbpl_penalties enable row level security;

create policy ccbpl_penalties_owner_all on ccbpl_penalties for all
  to authenticated
  using ( tenant_id = (select current_tenant_id()) )
  with check ( tenant_id = (select current_tenant_id()) );

-- ============================================================================
-- 10. ALERTS & ALERT SETTINGS — [RULE 1] two alert types, Mark Read only
-- ============================================================================
-- sms_logs and shop_notification_settings are REMOVED ENTIRELY — no CREATE
-- TABLE statements for them exist anywhere in this file.

create table alerts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  alert_type text not null check (alert_type in ('cash_not_deposited','overdue_threshold')),
  details text,
  severity text not null check (severity in ('HIGH','MEDIUM','LOW')),
  status text not null default 'unread' check (status in ('unread','read')),
  ref_table text,
  ref_id uuid,
  created_at timestamptz not null default now()
);
create index idx_alerts_tenant on alerts(tenant_id, status);
alter table alerts enable row level security;

-- Inserts are system-generated (by the scheduled jobs below, running as a
-- privileged role that bypasses RLS) — client-side policies only cover
-- reading and marking read.
create policy alerts_select on alerts for select
  to authenticated
  using ( tenant_id = (select current_tenant_id()) );

create policy alerts_mark_read on alerts for update
  to authenticated
  using ( tenant_id = (select current_tenant_id()) )
  with check ( tenant_id = (select current_tenant_id()) );

create table tenant_alert_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references tenants(id) on delete cascade,
  cash_not_deposited_enabled boolean not null default false,
  cash_not_deposited_hours integer not null default 24,
  overdue_threshold_enabled boolean not null default false,
  overdue_threshold_days integer not null default 0,   -- [FIX] default 0, not 30
  updated_at timestamptz not null default now()
);
create trigger trg_tenant_alert_settings_updated_at before update on tenant_alert_settings
  for each row execute function set_updated_at();
alter table tenant_alert_settings enable row level security;

create policy tenant_alert_settings_owner_rw on tenant_alert_settings for all
  to authenticated
  using ( tenant_id = (select current_tenant_id()) or (select is_platform_admin()) )
  with check ( tenant_id = (select current_tenant_id()) );

-- ----------------------------------------------------------------------------
-- 10b. TENANT SETTINGS — Auto-Assign toggle (System Settings, Section 2)
-- [GAP FOUND & FIXED] Referenced throughout the Blueprint's own narrative
-- ("controlled by tenant_settings.auto_assign_enabled") and by System
-- Settings Section 2, but missing from the original file. Added here.
-- ----------------------------------------------------------------------------

create table tenant_settings (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  auto_assign_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
create trigger trg_tenant_settings_updated_at before update on tenant_settings
  for each row execute function set_updated_at();
alter table tenant_settings enable row level security;

create policy tenant_settings_owner_rw on tenant_settings for all
  to authenticated
  using ( tenant_id = (select current_tenant_id()) or (select is_platform_admin()) )
  with check ( tenant_id = (select current_tenant_id()) );

-- [HARDENING] Auto-provision default settings the moment a tenant is
-- created, so System Settings is never blank for a brand-new distribution.
create or replace function create_tenant_defaults()
returns trigger
language plpgsql
as $$
begin
  insert into tenant_settings (tenant_id) values (new.id);
  insert into tenant_alert_settings (tenant_id) values (new.id);
  return new;
end;
$$;

create trigger trg_create_tenant_defaults after insert on tenants
  for each row execute function create_tenant_defaults();

-- ============================================================================
-- 11. BACKUPS — [FIX] manual-only, no size/modules
-- ============================================================================

create table backups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  backup_date timestamptz not null default now(),
  status text not null default 'in_progress' check (status in ('in_progress','completed','failed')),
  file_path text,
  created_at timestamptz not null default now()
);
alter table backups enable row level security;

create policy backups_owner_all on backups for all
  to authenticated
  using ( tenant_id = (select current_tenant_id()) )
  with check ( tenant_id = (select current_tenant_id()) );

-- ============================================================================
-- 12. ADMIN — Logs, Broadcast Banners, Feature Flags
-- ============================================================================

create table admin_logs (
  id uuid primary key default gen_random_uuid(),
  pk_timestamp timestamptz not null default now(),
  ip_address inet,
  is_mdos_user boolean not null default false,
  tenant_id uuid references tenants(id) on delete set null,
  pages_visited integer not null default 1,
  created_at timestamptz not null default now()
);
alter table admin_logs enable row level security;

create policy admin_logs_platform_only on admin_logs for all
  to authenticated
  using ( (select is_platform_admin()) )
  with check ( (select is_platform_admin()) );

create table admin_broadcast_banners (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  active boolean not null default true,
  created_by uuid references admins(id),
  created_at timestamptz not null default now()
);
alter table admin_broadcast_banners enable row level security;

create policy admin_broadcast_banners_read on admin_broadcast_banners for select
  to authenticated
  using ( active = true or (select is_platform_admin()) );

create policy admin_broadcast_banners_write on admin_broadcast_banners for insert
  to authenticated
  with check ( (select is_platform_admin()) );

create policy admin_broadcast_banners_update on admin_broadcast_banners for update
  to authenticated
  using ( (select is_platform_admin()) )
  with check ( (select is_platform_admin()) );

create table global_feature_flags (
  flag_key text primary key,
  label text not null,
  enabled boolean not null default true
);
alter table global_feature_flags enable row level security;

create policy global_feature_flags_read on global_feature_flags for select
  to authenticated using ( true );

create policy global_feature_flags_write on global_feature_flags for all
  to authenticated
  using ( (select is_platform_admin()) )
  with check ( (select is_platform_admin()) );

create table tenant_feature_flags (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  flag_key text not null references global_feature_flags(flag_key),
  enabled boolean not null default true,
  constraint uq_tenant_feature_flags unique (tenant_id, flag_key)
);
alter table tenant_feature_flags enable row level security;

create policy tenant_feature_flags_select on tenant_feature_flags for select
  to authenticated
  using ( tenant_id = (select current_tenant_id()) or (select is_platform_admin()) );

create policy tenant_feature_flags_write on tenant_feature_flags for all
  to authenticated
  using ( (select is_platform_admin()) )
  with check ( (select is_platform_admin()) );

-- Seed the flag list (Tab counts reflect this round's page removals)
insert into global_feature_flags (flag_key, label) values
  ('tab1', 'Tab 1 — Sales & Invoice Management (Pages 1-3)'),
  ('tab2', 'Tab 2 — Credit Control (Pages 1-2)'),
  ('tab3', 'Tab 3 — Inventory Control (Pages 1-4)'),
  ('tab4', 'Tab 4 — Delivery & Cash Tracking (Pages 1-3)'),
  ('tab5', 'Tab 5 — Data Backup (Page 1)'),
  ('tab6', 'Tab 6 — CCBPL Accounts (Pages 1-4)'),
  ('tab7', 'Tab 7 — Reports & Alerts (Pages 1-2)')
on conflict (flag_key) do nothing;

-- ============================================================================
-- 13. SCHEDULED JOBS (pg_cron) — optional, Job 1 & Job 2 only (Job 3 removed)
-- Requires: create extension if not exists pg_cron; (enable it in the
-- Supabase Dashboard → Database → Extensions first).
-- ============================================================================

create or replace function job_late_delivery_check()
returns void
language sql
security definer
as $$
  insert into late_deliveries (tenant_id, invoice_id, days_late, status)
  select
    i.tenant_id,
    i.id,
    (current_date - i.scheduled_date),
    case when i.visit_status = 'unvisited' then 'pending' else 'undelivered' end
  from invoices i
  where i.delivery_status in ('pending','undelivered')
    and i.scheduled_date < current_date
  on conflict (tenant_id, invoice_id)
  do update set days_late = excluded.days_late, status = excluded.status, updated_at = now();
$$;

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

select cron.schedule('mdos-late-delivery-check', '0 2 * * *', $$select job_late_delivery_check()$$);
select cron.schedule('mdos-cash-not-deposited-check', '0 * * * *', $$select job_cash_not_deposited_check()$$);
-- No Job 3 exists — nightly backup is removed; Backup Now is manual-only.
