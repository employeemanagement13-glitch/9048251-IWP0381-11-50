create table if not exists public.promo_invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  outlet_code text not null,
  shop_name text not null,
  invoice_no text not null,
  invoice_date date not null,
  col_01_trade_discount numeric(12,2) not null default 0,
  col_58_cross_promotion numeric(12,2) not null default 0,
  col_59_additional_trade numeric(12,2) not null default 0,
  col_63_distributor numeric(12,2) not null default 0,
  col_68_trade_promotions numeric(12,2) not null default 0,
  col_utc_discount numeric(12,2) not null default 0,
  row_total numeric(12,2) not null default 0,
  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.promo_invoices add column if not exists col_utc_discount numeric(12,2) not null default 0;

create index if not exists idx_promo_invoices_tenant on public.promo_invoices(tenant_id);
create index if not exists idx_promo_invoices_date on public.promo_invoices(tenant_id, invoice_date);
create unique index if not exists idx_promo_invoices_tenant_invoice on public.promo_invoices(tenant_id, invoice_no);

alter table public.promo_invoices enable row level security;

create policy "tenant_promo_invoices_select" on public.promo_invoices
  for select using (tenant_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id')::uuid);

create policy "tenant_promo_invoices_insert" on public.promo_invoices
  for insert with check (tenant_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id')::uuid);

create policy "tenant_promo_invoices_update" on public.promo_invoices
  for update using (tenant_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id')::uuid);

create policy "tenant_promo_invoices_delete" on public.promo_invoices
  for delete using (tenant_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id')::uuid);
