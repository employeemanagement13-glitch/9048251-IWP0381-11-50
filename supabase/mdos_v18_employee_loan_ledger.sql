-- ============================================================================
-- MDOS v18 — Employee loans + employee ledger
--
-- This migration adds the hidden employee ledger used by Employee Directory,
-- writes all ledger entries via triggers, and keeps the loan balance in sync
-- with payroll deductions without hand-maintaining totals.
--
-- Safe to re-run: uses IF EXISTS / OR REPLACE wherever needed.
-- ============================================================================

alter table employee_loans add column if not exists reason text;

-- 1. Hidden ledger table
create table if not exists employee_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  entry_date date not null default current_date,
  type text not null check (type in ('salary','loan')),
  direction text not null check (direction in ('in','out')),
  amount numeric(12,2) not null check (amount >= 0),
  source_table text not null,
  source_id uuid not null,
  description text,
  created_at timestamptz not null default now(),
  constraint uq_employee_ledger_source unique (tenant_id, source_table, source_id, type, direction)
);

create index if not exists idx_employee_ledger_employee_date
  on employee_ledger(tenant_id, employee_id, entry_date, created_at);

alter table employee_ledger enable row level security;

drop policy if exists employee_ledger_owner_all on employee_ledger;
create policy employee_ledger_owner_all on employee_ledger
  for all
  to authenticated
  using ( tenant_id = (select current_tenant_id()) )
  with check ( tenant_id = (select current_tenant_id()) );

-- 2. Loan disbursement ledger row
create or replace function post_employee_loan_to_ledger()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into employee_ledger (
    tenant_id,
    employee_id,
    entry_date,
    type,
    direction,
    amount,
    source_table,
    source_id,
    description
  ) values (
    new.tenant_id,
    new.employee_id,
    coalesce(new.issued_date, current_date),
    'loan',
    'in',
    new.principal_amount,
    'employee_loans',
    new.id,
    'Loan Disbursed'
  )
  on conflict (tenant_id, source_table, source_id, type, direction)
  do nothing;

  return new;
end;
$$;

drop trigger if exists trg_post_employee_loan_to_ledger on employee_loans;
create trigger trg_post_employee_loan_to_ledger
  after insert on employee_loans
  for each row execute function post_employee_loan_to_ledger();

-- 3. Payroll entries
create or replace function post_payroll_to_employee_ledger()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.loan_installment_applied > 0 then
    insert into employee_ledger (
      tenant_id,
      employee_id,
      entry_date,
      type,
      direction,
      amount,
      source_table,
      source_id,
      description
    ) values (
      new.tenant_id,
      new.employee_id,
      current_date,
      'loan',
      'out',
      new.loan_installment_applied,
      'payroll_runs',
      new.id,
      'Loan Installment Recovered — ' || to_char(new.salary_month, 'Mon YYYY')
    )
    on conflict (tenant_id, source_table, source_id, type, direction)
    do nothing;
  end if;

  insert into employee_ledger (
    tenant_id,
    employee_id,
    entry_date,
    type,
    direction,
    amount,
    source_table,
    source_id,
    description
  ) values (
    new.tenant_id,
    new.employee_id,
    current_date,
    'salary',
    'out',
    new.net_payable,
    'payroll_runs',
    new.id,
    'Salary Paid — ' || to_char(new.salary_month, 'Mon YYYY')
  )
  on conflict (tenant_id, source_table, source_id, type, direction)
  do nothing;

  return new;
end;
$$;

drop trigger if exists trg_post_payroll_to_employee_ledger on payroll_runs;
create trigger trg_post_payroll_to_employee_ledger
  after insert on payroll_runs
  for each row execute function post_payroll_to_employee_ledger();

-- 4. Running-balance view behind the page
create or replace view employee_ledger_view as
select
  el.id,
  el.tenant_id,
  el.employee_id,
  e.employee_code,
  e.full_name as employee_name,
  el.entry_date,
  el.type,
  el.direction,
  el.amount,
  el.description,
  case when el.direction = 'in' and el.type = 'loan' then el.amount else null end as in_amount,
  case when el.direction = 'out' and el.type = 'loan' then el.amount else null end as loan_out_amount,
  case when el.direction = 'out' and el.type = 'salary' then el.amount else null end as salary_out_amount,
  sum(
    case
      when el.type = 'loan' and el.direction = 'in' then el.amount
      when el.type = 'loan' and el.direction = 'out' then -el.amount
      else 0
    end
  ) over (
    partition by el.employee_id
    order by el.entry_date, el.created_at, el.id
  ) as running_balance,
  el.source_table,
  el.source_id,
  el.created_at
from employee_ledger el
join employees e on e.id = el.employee_id;

-- 5. Optional: same pattern as other ledgers, ensure newest rows show first in the page
-- This is a view, so the page can order as needed in SQL without storing redundant data.

-- 6. Backfill: if an employee has already received a loan before this migration,
--    do a one-time ledger insert for that historical row.
insert into employee_ledger (
  tenant_id,
  employee_id,
  entry_date,
  type,
  direction,
  amount,
  source_table,
  source_id,
  description
)
select
  l.tenant_id,
  l.employee_id,
  l.issued_date,
  'loan',
  'in',
  l.principal_amount,
  'employee_loans',
  l.id,
  'Loan Disbursed'
from employee_loans l
left join employee_ledger el
  on el.source_table = 'employee_loans'
 and el.source_id = l.id
where el.id is null
on conflict (tenant_id, source_table, source_id, type, direction) do nothing;

-- 7. Backfill payroll-driven ledger rows for prior payroll runs.
insert into employee_ledger (
  tenant_id,
  employee_id,
  entry_date,
  type,
  direction,
  amount,
  source_table,
  source_id,
  description
)
select
  pr.tenant_id,
  pr.employee_id,
  current_date,
  'loan',
  'out',
  pr.loan_installment_applied,
  'payroll_runs',
  pr.id,
  'Loan Installment Recovered — ' || to_char(pr.salary_month, 'Mon YYYY')
from payroll_runs pr
left join employee_ledger el
  on el.source_table = 'payroll_runs'
 and el.source_id = pr.id
 and el.type = 'loan'
 and el.direction = 'out'
where pr.loan_installment_applied > 0
  and el.id is null
on conflict (tenant_id, source_table, source_id, type, direction) do nothing;

insert into employee_ledger (
  tenant_id,
  employee_id,
  entry_date,
  type,
  direction,
  amount,
  source_table,
  source_id,
  description
)
select
  pr.tenant_id,
  pr.employee_id,
  current_date,
  'salary',
  'out',
  pr.net_payable,
  'payroll_runs',
  pr.id,
  'Salary Paid — ' || to_char(pr.salary_month, 'Mon YYYY')
from payroll_runs pr
left join employee_ledger el
  on el.source_table = 'payroll_runs'
 and el.source_id = pr.id
 and el.type = 'salary'
 and el.direction = 'out'
where el.id is null
on conflict (tenant_id, source_table, source_id, type, direction) do nothing;

-- ============================================================================
-- END OF v18 PATCH
-- ============================================================================
