-- Migration: 20260929_ccbpl_running_total_limit_history.sql
-- Table to track CCBPL running total limit changes over time per tenant

CREATE TABLE IF NOT EXISTS public.ccbpl_limit_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  effective_date date NOT NULL,
  limit_amount numeric(18,2) NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ccbpl_limit_history_tenant_date
  ON public.ccbpl_limit_history (tenant_id, effective_date);

ALTER TABLE public.ccbpl_limit_history ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'ccbpl_limit_history' AND policyname = 'Tenant ccbpl_limit_history policy'
  ) THEN
    CREATE POLICY "Tenant ccbpl_limit_history policy" ON public.ccbpl_limit_history
      FOR ALL USING (tenant_id = (SELECT auth.uid()));
  END IF;
END $$;
