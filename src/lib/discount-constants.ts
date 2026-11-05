export const PERMANENT_FROM = "1900-01-01";
export const PERMANENT_TO = "2099-12-31";

export function isPermanentDiscount(cfg: { from_date?: string | null; to_date?: string | null }): boolean {
  const from = (cfg.from_date || "").split("T")[0];
  const to = (cfg.to_date || "").split("T")[0];
  return from <= "1900-01-02" || to >= "2099-01-01";
}
