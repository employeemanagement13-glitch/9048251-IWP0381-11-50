create extension if not exists pg_cron;

create table if not exists global_alert_settings (
  alert_type text primary key check (alert_type in ('cash_not_deposited', 'overdue_threshold')),
  enabled boolean not null default true
);

insert into global_alert_settings (alert_type, enabled)
values
  ('cash_not_deposited', true),
  ('overdue_threshold', true)
on conflict (alert_type) do nothing;

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
        select 1
        from tenant_alert_settings tas
        where tas.tenant_id = i.tenant_id
          and tas.overdue_threshold_enabled = true
      )
      and exists (
        select 1
        from global_alert_settings gas
        where gas.alert_type = 'overdue_threshold'
          and gas.enabled = true
      )
  loop
    if not exists (
      select 1
      from alerts a
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

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (
      select 1
      from cron.job
      where jobname = 'mdos-overdue-alert-check'
    ) then
      perform cron.unschedule('mdos-overdue-alert-check');
    end if;

    if not exists (
      select 1
      from cron.job
      where jobname = 'mdos-overdue-alert-check'
    ) then
      perform cron.schedule(
        'mdos-overdue-alert-check',
        '*/5 * * * *',
        'select job_overdue_alert_check()'
      );
    end if;
  end if;
end;
$$;