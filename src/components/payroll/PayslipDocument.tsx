import React from "react";
import {
  Document, Page, Text, View, StyleSheet, Font,
} from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 9,
    color: "#1a1a1a",
    padding: 32,
    backgroundColor: "#ffffff",
  },
  header: {
    borderBottomWidth: 2,
    borderBottomColor: "#2563eb",
    paddingBottom: 10,
    marginBottom: 14,
  },
  headerTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  companyBlock: {
    flex: 1,
  },
  companyName: {
    fontSize: 15,
    fontFamily: "Helvetica-Bold",
    color: "#1e3a5f",
    marginBottom: 2,
  },
  companyAddress: {
    fontSize: 8,
    color: "#555",
  },
  slipTitle: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
    color: "#2563eb",
    textAlign: "right",
  },
  slipMonth: {
    fontSize: 8,
    color: "#555",
    textAlign: "right",
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#2563eb",
    backgroundColor: "#eff6ff",
    paddingHorizontal: 6,
    paddingVertical: 3,
    marginBottom: 4,
    marginTop: 10,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  table: {
    width: "100%",
  },
  row: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#e5e7eb",
    paddingVertical: 3,
    paddingHorizontal: 4,
  },
  rowAlt: {
    backgroundColor: "#f9fafb",
  },
  label: {
    flex: 1,
    color: "#6b7280",
    fontSize: 8.5,
  },
  value: {
    flex: 1,
    fontFamily: "Helvetica-Bold",
    fontSize: 8.5,
    textAlign: "right",
  },
  labelLeft: {
    flex: 1.5,
    color: "#6b7280",
    fontSize: 8.5,
  },
  amountRight: {
    width: 80,
    fontFamily: "Helvetica-Bold",
    fontSize: 8.5,
    textAlign: "right",
  },
  totalRow: {
    flexDirection: "row",
    paddingVertical: 4,
    paddingHorizontal: 4,
    backgroundColor: "#1e3a5f",
  },
  totalLabel: {
    flex: 1.5,
    color: "#ffffff",
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
  },
  totalAmount: {
    width: 80,
    color: "#ffffff",
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    textAlign: "right",
  },
  netPayRow: {
    flexDirection: "row",
    paddingVertical: 5,
    paddingHorizontal: 4,
    backgroundColor: "#2563eb",
    marginTop: 2,
    borderRadius: 2,
  },
  netPayLabel: {
    flex: 1.5,
    color: "#ffffff",
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
  },
  netPayAmount: {
    width: 80,
    color: "#ffffff",
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    textAlign: "right",
  },
  overrideBanner: {
    backgroundColor: "#fef3c7",
    borderWidth: 1,
    borderColor: "#f59e0b",
    borderRadius: 3,
    padding: 6,
    marginTop: 8,
  },
  overrideText: {
    fontSize: 8,
    color: "#92400e",
    fontFamily: "Helvetica-Bold",
  },
  balanceCarriedRow: {
    flexDirection: "row",
    paddingVertical: 3,
    paddingHorizontal: 4,
    backgroundColor: "#fef3c7",
  },
  balanceLabel: {
    flex: 1.5,
    color: "#92400e",
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
  },
  balanceAmount: {
    width: 80,
    color: "#92400e",
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
    textAlign: "right",
  },
  signaturesRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 28,
  },
  sigBlock: {
    width: "40%",
    borderTopWidth: 1,
    borderTopColor: "#d1d5db",
    paddingTop: 4,
    alignItems: "center",
  },
  sigLabel: {
    fontSize: 8,
    color: "#6b7280",
  },
  footerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 12,
    paddingTop: 6,
    borderTopWidth: 0.5,
    borderTopColor: "#e5e7eb",
  },
  footerText: {
    fontSize: 7.5,
    color: "#9ca3af",
  },
  twoCol: {
    flexDirection: "row",
    gap: 8,
  },
  colHalf: {
    flex: 1,
  },
});

const rs = (n: any) =>
  n != null ? `Rs. ${Number(n).toLocaleString("en-PK", { minimumFractionDigits: 0 })}` : "Rs. 0";

const fmtMonth = (dateStr: string) => {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-PK", { month: "long", year: "numeric" });
};

interface PayslipData {
  run: {
    id: string;
    salary_month: string;
    working_days: number;
    basic_salary: number;
    bonus_amount: number;
    absent_deduction: number;
    sop_violation_deduction: number;
    net_salary: number;
    loan_installment_due: number;
    loan_installment_applied: number;
    net_payable: number;
    balance_carried: number;
    operator?: string;
    computer_voucher?: string;
    created_at: string;
  };
  employee: {
    employee_code?: string;
    full_name: string;
    role?: string;
    phone?: string;
    bank_name?: string;
    bank_account?: string;
    joining_date?: string;
  };
  sop?: {
    name: string;
    biometric_enabled: boolean;
    shift_start?: string;
    shift_end?: string;
    morning_grace_minutes?: number;
    grace_limit_days?: number;
  } | null;
  loan?: {
    id: string;
    principal_amount: number;
    outstanding_balance: number;
    installment_cap_pct: number;
    status: string;
    override_reason?: string;
  } | null;
  distributor?: {
    name?: string;
    address?: string;
  };
}

export function PayslipDocument({ run, employee, sop, loan, distributor }: PayslipData) {
  const showLoan = loan != null && (run.loan_installment_due > 0 || run.loan_installment_applied > 0);

  const grossEarnings = run.basic_salary + run.bonus_amount;
  const totalDeductions = run.absent_deduction + (run.sop_violation_deduction || 0);
  const month = fmtMonth(run.salary_month);

  return (
    <Document title={`Payslip ${employee.full_name} ${month}`}>
      <Page size="A4" style={styles.page}>

        <View style={styles.header}>
          <View style={styles.headerTop}>
            <View style={styles.companyBlock}>
              <Text style={styles.companyName}>{distributor?.name || "Distributor"}</Text>
              <Text style={styles.companyAddress}>{distributor?.address || ""}</Text>
            </View>
            <View>
              <Text style={styles.slipTitle}>PAYSLIP</Text>
              <Text style={styles.slipMonth}>{month}</Text>
              {run.computer_voucher && (
                <Text style={styles.slipMonth}>Voucher # {run.computer_voucher}</Text>
              )}
            </View>
          </View>
        </View>

        <Text style={styles.sectionTitle}>A. Employee Details</Text>
        <View style={styles.table}>
          <View style={styles.twoCol}>
            <View style={styles.colHalf}>
              {[
                ["Employee Code", employee.employee_code || "—"],
                ["Full Name", employee.full_name],
                ["Role", employee.role || "—"],
                ["Phone", employee.phone || "—"],
              ].map(([l, v], i) => (
                <View key={l} style={[styles.row, i % 2 === 1 ? styles.rowAlt : {}]}>
                  <Text style={styles.label}>{l}</Text>
                  <Text style={styles.value}>{v}</Text>
                </View>
              ))}
            </View>
            <View style={styles.colHalf}>
              {[
                ["Joining Date", employee.joining_date || "—"],
                ["Bank", employee.bank_name || "—"],
                ["Account No.", employee.bank_account || "—"],
                ["Salary Month", month],
              ].map(([l, v], i) => (
                <View key={l} style={[styles.row, i % 2 === 1 ? styles.rowAlt : {}]}>
                  <Text style={styles.label}>{l}</Text>
                  <Text style={styles.value}>{v}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>

        <Text style={styles.sectionTitle}>B. Earnings</Text>
        <View style={styles.table}>
          {[
            ["Basic Salary", run.basic_salary],
            ["Bonus / Incentive", run.bonus_amount],
          ].map(([l, v], i) => (
            <View key={String(l)} style={[styles.row, i % 2 === 1 ? styles.rowAlt : {}]}>
              <Text style={styles.labelLeft}>{l}</Text>
              <Text style={styles.amountRight}>{rs(v)}</Text>
            </View>
          ))}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Gross Earnings</Text>
            <Text style={styles.totalAmount}>{rs(grossEarnings)}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>C. Deductions</Text>
        <View style={styles.table}>
          {[
            ["Absent Deduction", run.absent_deduction],
            ...(run.sop_violation_deduction ? [["SOP Violation Deduction", run.sop_violation_deduction]] : []),
          ].map(([l, v], i) => (
            <View key={String(l)} style={[styles.row, i % 2 === 1 ? styles.rowAlt : {}]}>
              <Text style={styles.labelLeft}>{l}</Text>
              <Text style={styles.amountRight}>{rs(v)}</Text>
            </View>
          ))}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total Deductions</Text>
            <Text style={styles.totalAmount}>{rs(totalDeductions)}</Text>
          </View>
          <View style={[styles.row]}>
            <Text style={[styles.labelLeft, { fontFamily: "Helvetica-Bold" }]}>Net Salary (Gross − Deductions)</Text>
            <Text style={[styles.amountRight, { fontFamily: "Helvetica-Bold" }]}>{rs(run.net_salary)}</Text>
          </View>
        </View>

        {showLoan && (
          <>
            <Text style={styles.sectionTitle}>D. Loan / Advance Adjustment</Text>
            <View style={styles.table}>
              {[
                ["Loan Installment Due", run.loan_installment_due],
                ["Loan Installment Applied", run.loan_installment_applied],
              ].map(([l, v], i) => (
                <View key={String(l)} style={[styles.row, i % 2 === 1 ? styles.rowAlt : {}]}>
                  <Text style={styles.labelLeft}>{l}</Text>
                  <Text style={styles.amountRight}>{rs(v)}</Text>
                </View>
              ))}
              <View style={[styles.row, styles.rowAlt]}>
                <Text style={styles.labelLeft}>Outstanding Loan Balance (after this cycle)</Text>
                <Text style={styles.amountRight}>{rs(loan?.outstanding_balance ?? 0)}</Text>
              </View>
            </View>
          </>
        )}

        <Text style={styles.sectionTitle}>E. Net Pay Summary</Text>
        <View style={styles.table}>
          <View style={styles.row}>
            <Text style={styles.labelLeft}>Net Salary</Text>
            <Text style={styles.amountRight}>{rs(run.net_salary)}</Text>
          </View>
          {showLoan && (
            <View style={[styles.row, styles.rowAlt]}>
              <Text style={styles.labelLeft}>Less: Loan Installment Applied</Text>
              <Text style={styles.amountRight}>({rs(run.loan_installment_applied)})</Text>
            </View>
          )}
          <View style={styles.netPayRow}>
            <Text style={styles.netPayLabel}>NET PAYABLE</Text>
            <Text style={styles.netPayAmount}>{rs(run.net_payable)}</Text>
          </View>
          {Number(run.balance_carried) > 0 && (
            <View style={styles.balanceCarriedRow}>
              <Text style={styles.balanceLabel}>
                Balance Carried Forward
              </Text>
              <Text style={styles.balanceAmount}>{rs(run.balance_carried)}</Text>
            </View>
          )}
        </View>

        <View style={styles.signaturesRow}>
          <View style={styles.sigBlock}>
            <Text style={styles.sigLabel}>Employee Signature</Text>
          </View>
          <View style={styles.sigBlock}>
            <Text style={styles.sigLabel}>Approved By</Text>
          </View>
        </View>

        <View style={styles.footerRow}>
          <Text style={styles.footerText}>
            Generated By: {run.operator || "System"} · {new Date(run.created_at).toLocaleDateString("en-PK")}
          </Text>
          <Text style={styles.footerText}>
            Status: Finalized
          </Text>
        </View>
      </Page>
    </Document>
  );
}
