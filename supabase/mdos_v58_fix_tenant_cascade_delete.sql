ALTER TABLE sale_entries 
  DROP CONSTRAINT IF EXISTS sale_entries_tenant_id_fkey,
  ADD CONSTRAINT sale_entries_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE sale_entry_lines 
  DROP CONSTRAINT IF EXISTS sale_entry_lines_tenant_id_fkey,
  ADD CONSTRAINT sale_entry_lines_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE stock_report_entries 
  DROP CONSTRAINT IF EXISTS stock_report_entries_tenant_id_fkey,
  ADD CONSTRAINT stock_report_entries_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
