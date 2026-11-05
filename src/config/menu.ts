import {
  type LucideIcon,
  ArrowLeftRight,
  BadgePercent,
  Banknote,
  BarChart3,
  Bell,
  Boxes,
  CalendarClock,
  ChartColumn,
  DatabaseBackup,
  Landmark,
  MapPin,
  NotebookPen,
  Package,
  PackageCheck,
  ReceiptText,
  Settings,
  ShieldBan,
  Store,
  Tag,
  Users,
  HardHat,
} from "lucide-react";

export interface MenuItem {
  name: string;
  path: string;
  icon?: LucideIcon;
}

export interface TabItem {
  id: number;
  title: string;
  icon?: LucideIcon;
  pages: MenuItem[];
}

export const menuTabs: TabItem[] = [
  {
    id: 0,
    title: "Setup & Masters",
    icon: Store,
    pages: [
      { name: "Shops Directory", path: "/shop-details", icon: Store },
      { name: "Products Menu", path: "/prerequisites/products", icon: Package },
      { name: "Vehicles", path: "/prerequisites/dm-routes", icon: MapPin },
      { name: "Blocked Shops", path: "/tab2/blocked", icon: ShieldBan },
    ],
  },
  {
    id: 1,
    title: "Sales & Credit",
    icon: ReceiptText,
    pages: [
      { name: "Invoices Management", path: "/tab1/transactions", icon: ReceiptText },
      { name: "Promo Management", path: "/sales-credit/promo-management", icon: Tag },
      { name: "Credit Used & Recovery", path: "/tab2/credit", icon: Banknote },
      { name: "Additional Discounts", path: "/prerequisites/discounts", icon: BadgePercent },
    ],
  },

  {
    id: 2,
    title: "Deposits & Accounts",
    icon: Landmark,
    pages: [
      { name: "Deposits & Movements", path: "/cash-bank/deposits", icon: Banknote },
      { name: "Accounts", path: "/cash-bank/bank-accounts", icon: Landmark },
    ],
  },
  {
    id: 3,
    title: "Inventory",
    icon: Boxes,
    pages: [
      { name: "Warehouse Stock", path: "/inventory/warehouse", icon: Boxes },
      { name: "Empties Movements", path: "/inventory/empties-movements", icon: ArrowLeftRight },
      { name: "Sell In (CCBPL)", path: "/inventory/sell-in", icon: PackageCheck },
    ],
  },
  {
    id: 4,
    title: "Backups",
    icon: DatabaseBackup,
    pages: [
      { name: "Backup", path: "/tab5/backup", icon: DatabaseBackup },
    ],
  },
  {
    id: 5,
    title: "Reports, Sheets & Alerts",
    icon: Bell,
    pages: [
      { name: "Stock Reports", path: "/inventory/stock-reports", icon: BarChart3 },
      { name: "Financial Reports", path: "/reports/financial", icon: ChartColumn },
      { name: "Balance Sheet", path: "/income/balance-sheet", icon: Landmark },
      { name: "Real-Time Alerts", path: "/tab7/alerts", icon: Bell },
    ],
  },
  {
    id: 6,
    title: "Expenses",
    icon: NotebookPen,
    pages: [
      { name: "Agency Expenses", path: "/expenses/agency", icon: ReceiptText },
      { name: "Expense Sheet", path: "/expenses/sheet", icon: NotebookPen },
    ],
  },
  {
    id: 7,
    title: "Income Management",
    icon: BarChart3,
    pages: [
      { name: "Income Sources", path: "/income/margin", icon: BarChart3 },
      { name: "Income Statement", path: "/income/statement", icon: ChartColumn },
    ],
  },
  {
    id: 8,
    title: "Employee Management",
    icon: Users,
    pages: [
      { name: "Employee Directory", path: "/employee-management/directory", icon: Users },
      { name: "Payroll Runs", path: "/employee-management/payroll", icon: CalendarClock },
      { name: "Loans", path: "/employee-management/loans", icon: Banknote },
      { name: "Laborers", path: "/employee-management/laborers", icon: HardHat },
    ],
  },
];

export const standalonePages = [
  { name: "Settings", path: "/settings", icon: Settings },
];

export function getRouteMetadata(path: string) {
  if (path === "/settings") {
    return { category: "System", title: "System Settings" };
  }

  for (const tab of menuTabs) {
    const page = tab.pages.find((p) => path.startsWith(p.path));
    if (page) {
      return {
        category: tab.title,
        title: page.name,
      };
    }
  }

  // Legacy route aliases (hidden but still routable — §14 hidden-not-removed)
  const legacyMap: Record<string, { category: string; title: string }> = {
    "/tab1/invoices":       { category: "Sales & Credit", title: "Sales Transactions (Legacy)" },
    "/tab1/routes":         { category: "Sales & Credit", title: "Dispatch & Routes (Legacy)" },
    "/tab1/late-delivery":  { category: "Sales & Credit", title: "Late Delivery Tracker" },
    "/tab4/daily-summary": { category: "Cash & Bank", title: "Daily Summary" },
    "/tab4/reconciliation": { category: "Cash & Bank", title: "Cash Reconciliation" },
    "/employees":           { category: "Employee Management", title: "Employee Directory" },
    "/tab3/warehouse":      { category: "Inventory", title: "Warehouse Stock" },
    "/tab3/damaged":        { category: "Inventory", title: "Damaged Stock" },
    "/tab3/returns":        { category: "Inventory", title: "Returns / Wayback" },
    "/tab3/empties":        { category: "Inventory", title: "Empties Log" },
    "/tab3/audit":          { category: "Inventory", title: "Stock Count / Audit" },
    "/tab6/purchasing":     { category: "Inventory", title: "Purchasing from CCBPL (legacy)" },
    "/tab7/discrepancy":    { category: "Reports & Alerts", title: "Stock Discrepancy" },
  };
  for (const [prefix, meta] of Object.entries(legacyMap)) {
    if (path.startsWith(prefix)) return meta;
  }

  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return { category: "Home", title: "Home" };

  const cleanSegment = (str: string) =>
    str.replace(/-/g, " ").split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

  const category = cleanSegment(parts[0]);
  const title = parts[1] ? cleanSegment(parts[1]) : category;

  return { category, title };
}
