-- Add is_filer column to shops table
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS is_filer BOOLEAN DEFAULT false;
