-- mdos_v67_stock_report_amount.sql
-- Migration: Add amount column to stock_report_entries for manual Opening Stock valuation

ALTER TABLE stock_report_entries ADD COLUMN IF NOT EXISTS amount NUMERIC(14,2) DEFAULT 0;
