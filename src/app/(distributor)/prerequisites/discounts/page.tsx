import { getShops } from "@/lib/actions/shops";
import { getProducts } from "@/lib/actions/products";
import { getEmployees } from "@/lib/actions/employees";
import { getDiscountConfigs } from "@/lib/actions/discounts";
import { PageHeader } from "@/components/layout/PageHeader";
import { DiscountsClient } from "./DiscountsClient";

export const metadata = { title: "Additional Discounts" };

export default async function DiscountsPage() {
  const [shops, products, employees, discountConfigs] = await Promise.all([
    getShops(),
    getProducts(),
    getEmployees(),
    getDiscountConfigs(),
  ]);

  // Accurately gather all presellers
  const presellerMap = new Map<string, { id: string; full_name: string; employee_code?: string }>();

  // 1. All employees whose role is preseller or order_booker (case-insensitive)
  (employees || []).forEach((e: any) => {
    const roleNorm = String(e.role || "").trim().toLowerCase();
    if (roleNorm === "preseller" || roleNorm.includes("presell") || roleNorm === "order_booker") {
      presellerMap.set(e.id, {
        id: e.id,
        full_name: e.full_name,
        employee_code: e.employee_code,
      });
    }
  });

  // 2. Any employees whose names match preseller_name in shops
  const shopPresellerNames = new Set(
    (shops || []).map((s: any) => String(s.preseller_name || "").trim().toLowerCase()).filter(Boolean)
  );
  (employees || []).forEach((e: any) => {
    const nameNorm = String(e.full_name || "").trim().toLowerCase();
    if (!presellerMap.has(e.id) && shopPresellerNames.has(nameNorm)) {
      presellerMap.set(e.id, {
        id: e.id,
        full_name: e.full_name,
        employee_code: e.employee_code,
      });
    }
  });

  // 3. Any preseller referenced in existing discount configs
  (discountConfigs || []).forEach((cfg: any) => {
    if (cfg.preseller?.id && !presellerMap.has(cfg.preseller.id)) {
      presellerMap.set(cfg.preseller.id, {
        id: cfg.preseller.id,
        full_name: cfg.preseller.full_name,
        employee_code: cfg.preseller.employee_code,
      });
    }
  });

  const presellers = Array.from(presellerMap.values()).sort((a, b) =>
    (a.full_name || "").localeCompare(b.full_name || "")
  );

  return (
    <div className="p-6">
      <PageHeader
        title="Additional Discounts"
        subtitle="Sales & Credit — Manage product discounts, active validity dates, and authorized preseller/owner discounts"
      />
      <DiscountsClient
        shops={shops || []}
        products={products || []}
        presellers={presellers}
        initialConfigs={discountConfigs || []}
      />
    </div>
  );
}
