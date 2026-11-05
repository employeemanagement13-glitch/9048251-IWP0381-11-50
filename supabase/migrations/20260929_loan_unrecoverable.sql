alter table public.employee_loans add column if not exists is_unrecoverable boolean not null default false;
create index if not exists idx_employee_loans_unrecoverable on public.employee_loans(tenant_id, is_unrecoverable);
