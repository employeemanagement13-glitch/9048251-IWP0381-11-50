create table if not exists public.manual_income_statement_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  month_year text not null,
  section text not null,
  description text,
  amount numeric(14,2) default 0,
  entry_date date,
  line_items jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_manual_is_records_tenant_month on public.manual_income_statement_records(tenant_id, month_year);
create index if not exists idx_manual_is_records_section on public.manual_income_statement_records(tenant_id, month_year, section);

alter table public.manual_income_statement_records enable row level security;

create policy "tenant_manual_is_select" on public.manual_income_statement_records
  for select using (tenant_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id')::uuid);

create policy "tenant_manual_is_insert" on public.manual_income_statement_records
  for insert with check (tenant_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id')::uuid);

create policy "tenant_manual_is_update" on public.manual_income_statement_records
  for update using (tenant_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id')::uuid);

create policy "tenant_manual_is_delete" on public.manual_income_statement_records
  for delete using (tenant_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id')::uuid);
