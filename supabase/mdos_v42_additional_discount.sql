ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS additional_discount NUMERIC(14,2) NOT NULL DEFAULT 0;

NOTIFY pgrst, 'reload schema';
