-- ============================================================================
-- mdos_v73b_repair_bank_opening_balances.sql  --  RUN ONCE, AFTER v73.
--
-- Removes the drift that the old triggers already added to
-- bank_accounts.current_balance (the opening balance), so each account's
-- opening balance returns to the amount originally entered:
--   * deposits marked 'deposited' were ADDED   -> subtract them
--   * billed Sell-In orders were SUBTRACTED     -> add them back
--
-- REVIEW the SELECT first. Accounts whose opening balance was edited manually
-- after those transactions may need to be adjusted by hand.
-- ============================================================================

-- Preview
select ba.id, ba.account_title, ba.current_balance as stored_opening,
       coalesce(d.total, 0) as deposits_added,
       coalesce(p.total, 0) as po_payments_subtracted,
       ba.current_balance - coalesce(d.total, 0) + coalesce(p.total, 0) as repaired_opening
from bank_accounts ba
left join (
  select bank_account_id, sum(amount) total from cash_deposits
  where status = 'deposited' and bank_account_id is not null group by bank_account_id
) d on d.bank_account_id = ba.id
left join (
  select sio.paid_from_bank_account_id as bank_account_id,
         sum((select coalesce(sum(case when invoice_type = 'purchase' then net_bill_amount else -net_bill_amount end), 0)
              from sell_in_lines where sell_in_order_id = sio.id)) total
  from sell_in_orders sio
  where sio.status = 'billed' and sio.paid_from_bank_account_id is not null
  group by sio.paid_from_bank_account_id
) p on p.bank_account_id = ba.id;

-- Apply (uncomment after reviewing the preview)
-- update bank_accounts ba set current_balance = ba.current_balance
--   - coalesce((select sum(amount) from cash_deposits cd
--               where cd.bank_account_id = ba.id and cd.status = 'deposited'), 0)
--   + coalesce((select sum((select coalesce(sum(case when invoice_type = 'purchase' then net_bill_amount else -net_bill_amount end), 0)
--                           from sell_in_lines where sell_in_order_id = sio.id))
--               from sell_in_orders sio
--               where sio.paid_from_bank_account_id = ba.id and sio.status = 'billed'), 0);
