create or replace view employee_ledger_view as
select
  el.id,
  el.tenant_id,
  el.employee_id,
  e.employee_code,
  e.full_name as employee_name,
  el.entry_date,
  case
    when el.type = 'loan' and el.direction = 'in' and el.source_table = 'employee_loans' and (
      select nullif(trim(loans.reason), '')
      from employee_loans loans
      where loans.id = el.source_id
      limit 1
    ) is not null
    then 'loan (' || (
      select trim(loans.reason)
      from employee_loans loans
      where loans.id = el.source_id
      limit 1
    ) || ')'
    else el.type
  end as type,
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
