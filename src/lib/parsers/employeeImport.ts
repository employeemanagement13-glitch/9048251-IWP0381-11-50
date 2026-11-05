import * as XLSX from "xlsx";
import Papa from "papaparse";
import type { EmployeeFormData } from "@/lib/actions/employees";

const ROLES = [
  { value: "dm", label: "Delivery Man" },
  { value: "preseller", label: "Preseller" },
  { value: "operation_manager", label: "Operation Manager" },
  { value: "loader", label: "Loader" },
  { value: "lifter_operator", label: "Lifter Operator" },
  { value: "dvo", label: "DVO" },
  { value: "driver", label: "Driver" },
  { value: "guard", label: "Guard" },
  { value: "office", label: "Office" },
  { value: "other", label: "Other" },
] as const;

export function parseExcelDate(val: any): string | undefined {
  if (val === undefined || val === null || val === "") return undefined;

  if (val instanceof Date && !isNaN(val.getTime())) {
    return val.toISOString().split("T")[0];
  }

  if (typeof val === "number") {
    const dateObj = XLSX.SSF ? XLSX.SSF.parse_date_code(val) : null;
    if (dateObj) {
      const y = dateObj.y;
      const m = String(dateObj.m).padStart(2, "0");
      const d = String(dateObj.d).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }
    const d = new Date(Math.round((val - 25569) * 86400 * 1000));
    if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
  }

  const str = String(val).trim();
  if (!str) return undefined;

  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str;
  }

  const dmy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) {
    const d = dmy[1].padStart(2, "0");
    const m = dmy[2].padStart(2, "0");
    const y = dmy[3];
    return `${y}-${m}-${d}`;
  }

  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split("T")[0];
  }

  return undefined;
}

/** Stable slug for unknown Excel roles: "Fork Lift" → "fork_lift". Empty → "dm". */
export function slugifyEmployeeRole(raw: any): string {
  const s = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[\s\-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return s || "dm";
}

export function matchEmployeeRole(raw: any): EmployeeFormData["role"] {
  const text = String(raw || "").trim();
  if (!text) return "dm";

  const norm = text.toLowerCase().replace(/[\s_-]+/g, "");
  const found = ROLES.find(
    (r) =>
      r.value.toLowerCase().replace(/[\s_-]+/g, "") === norm ||
      r.label.toLowerCase().replace(/[\s_-]+/g, "") === norm
  );
  if (found) return found.value as EmployeeFormData["role"];
  // Keep custom Excel roles (e.g. Sweeper) instead of forcing Delivery Man
  return slugifyEmployeeRole(text) as EmployeeFormData["role"];
}

export async function parseEmployeeExcel(file: File): Promise<EmployeeFormData[]> {
  const fileName = file.name.toLowerCase();
  const isExcel = fileName.endsWith(".xlsx") || fileName.endsWith(".xls");

  let rawRows: any[] = [];

  if (isExcel) {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array", cellDates: false });
    const firstSheet = workbook.SheetNames[0];
    if (firstSheet) {
      rawRows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], { defval: "" });
    }
  } else {
    const text = await file.text();
    const results = Papa.parse<any>(text, { header: true, skipEmptyLines: true });
    rawRows = results.data;
  }

  if (!rawRows || rawRows.length === 0) {
    return [];
  }

  return rawRows
    .map((row: any) => {
      const code = String(
        row["Employee Code (Auto)"] ||
        row["Employee Code"] ||
        row["employee_code"] ||
        row["Code"] ||
        row["code"] ||
        ""
      ).trim();

      const name = String(
        row["Full Name"] ||
        row["Name"] ||
        row["full_name"] ||
        row["Employee Name"] ||
        ""
      ).trim();

      const rawSalary = String(
        row["Basic Salary (Rs.)"] ||
        row["Basic Salary"] ||
        row["basic_salary"] ||
        row["Salary"] ||
        "0"
      );
      const salary = parseFloat(rawSalary.replace(/[^0-9.]/g, "")) || 0;

      const rawHouseOwner = String(row["House Owner"] || row["house_owner"] || "").trim().toLowerCase();
      const house_owner = rawHouseOwner === "true" || rawHouseOwner === "1" || rawHouseOwner === "yes";

      const rawStatus = String(row["Status"] || row["active"] || "").trim().toLowerCase();
      const active = !(rawStatus === "inactive" || rawStatus === "false" || rawStatus === "0" || rawStatus === "no");

      return {
        employee_code: code || undefined,
        full_name: name,
        role: matchEmployeeRole(row["Role"] || row["role"] || row["Designation"]),
        phone: String(row["Phone"] || row["phone"] || row["Mobile"] || "").trim() || undefined,
        nic: String(row["NIC"] || row["nic"] || row["CNIC"] || "").trim() || undefined,
        address: String(row["Address"] || row["address"] || "").trim() || undefined,
        joining_date: parseExcelDate(row["Joining Date"] || row["joining_date"] || row["Date of Joining"]),
        basic_salary: salary,
        bank_name: String(row["Bank Name"] || row["bank_name"] || "").trim() || undefined,
        bank_account: String(row["Account Number"] || row["Bank Account"] || row["bank_account"] || "").trim() || undefined,
        house_owner,
        emergency_contact: String(row["Emergency Contact"] || row["emergency_contact"] || "").trim() || undefined,
        emergency_phone: String(row["Emergency Phone"] || row["emergency_phone"] || "").trim() || undefined,
        reference_1_name: String(row["1st Reference Name"] || row["reference_1_name"] || "").trim() || undefined,
        reference_1_phone: String(row["1st Reference Phone"] || row["reference_1_phone"] || "").trim() || undefined,
        reference_2_name: String(row["2nd Reference Name"] || row["reference_2_name"] || "").trim() || undefined,
        reference_2_phone: String(row["2nd Reference Phone"] || row["reference_2_phone"] || "").trim() || undefined,
        active,
      } as EmployeeFormData;
    })
    .filter((e) => Boolean(e.full_name && e.full_name.trim().length > 0));
}
