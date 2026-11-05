-- ============================================================================
-- MDOS — DAY 4 SCHEMA PATCH
-- Covers:
--   1. check_late_deliveries() function (copies invoice's real delivery_status)
--   2. pg_cron Job registrations for check_late_deliveries() and job_cash_not_deposited_check()
-- ============================================================================

create or replace function check_late_deliveries()
returns void
language plpgsql
security definer
as $$
begin
  insert into late_deliveries (tenant_id, invoice_id, days_late, status)
  select
    i.tenant_id,
    i.id,
    (current_date - i.scheduled_date),
    case
      when i.delivery_status = 'pending' then 'pending'::text
      when i.delivery_status = 'undelivered' then 'undelivered'::text
      else 'pending'::text
    end as status
  from invoices i
  where i.delivery_status in ('pending', 'undelivered')
    and i.scheduled_date < current_date
  on conflict (tenant_id, invoice_id)
  do update set
    days_late = excluded.days_late,
    status = excluded.status,
    updated_at = now();
end;
$$;

-- Register pg_cron jobs (if pg_cron extension exists)
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- Unschedules if exists to prevent duplicates
    perform cron.unschedule('mdos-late-delivery-check');
    perform cron.unschedule('mdos-cash-not-deposited-check');
    
    perform cron.schedule('mdos-late-delivery-check', '5 0 * * *', 'select check_late_deliveries()');
    perform cron.schedule('mdos-cash-not-deposited-check', '0 * * * *', 'select job_cash_not_deposited_check()');
  end if;
end;
$$;
