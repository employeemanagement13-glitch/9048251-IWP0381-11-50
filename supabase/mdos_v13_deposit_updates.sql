-- ============================================================================
-- MDOS v13 — Deposit Updates Fix
--
-- Goals:
--   Allow the `auto_create_cash_deposit` trigger to update the deposit amount
--   even if the deposit has already been marked as 'deposited'. 
--   This ensures the historical deposit record correctly matches the total 
--   payment amount for credit invoices.
-- ============================================================================

create or replace function auto_create_cash_deposit()
returns trigger
language plpgsql
security definer
as $$
declare
  v_was_delivered boolean := false;
  v_deposit_amount numeric;
begin
  if tg_op = 'UPDATE' then
    v_was_delivered := (old.delivery_status = 'delivered');
  end if;

  -- -------------------------------------------------------------------------
  -- Case A: Forward delivery
  -- -------------------------------------------------------------------------
  if new.delivery_status = 'delivered' and not v_was_delivered then

    if new.invoice_type = 'cash' then
      v_deposit_amount := new.invoice_total - new.discount_amount + new.advance_tax;
    else
      v_deposit_amount := coalesce(new.amount_received, 0);
    end if;

    insert into cash_deposits (tenant_id, deposit_date, amount, for_date, status, invoice_id)
    values (
      new.tenant_id,
      current_date,
      v_deposit_amount,
      new.scheduled_date,
      'pending',
      new.id
    );

  -- -------------------------------------------------------------------------
  -- Case B: Reversal — remove the auto-created 'pending' deposit
  --   We only remove deposits that are still 'pending'. If the user has already
  --   confirmed the deposit (status = 'deposited'), we leave it and let them
  --   manage it manually.
  -- -------------------------------------------------------------------------
  elsif new.delivery_status <> 'delivered' and v_was_delivered then

    delete from cash_deposits
    where invoice_id = old.id
      and status     = 'pending';

  -- -------------------------------------------------------------------------
  -- Case C: Credit invoice stays delivered, amount_received changed
  --   Update the linked deposit amount regardless of whether it is pending
  --   or already deposited, so the deposit record reflects the actual payment.
  -- -------------------------------------------------------------------------
  elsif new.delivery_status = 'delivered'
        and v_was_delivered
        and new.invoice_type = 'credit'
        and new.amount_received is distinct from old.amount_received
  then
    update cash_deposits
    set    amount = coalesce(new.amount_received, 0)
    where  invoice_id = new.id;

  end if;

  return new;
end;
$$;
