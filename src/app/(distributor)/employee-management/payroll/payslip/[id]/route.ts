import { NextRequest, NextResponse } from "next/server";
import { renderToStream } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { getPayrollRunById } from "@/lib/actions/payroll";
import { PayslipDocument } from "@/components/payroll/PayslipDocument";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const run = await getPayrollRunById(id);

    if (!run) {
      return new NextResponse("Payroll run not found", { status: 404 });
    }

    const supabase = await createClient();
    const { data: tenant } = await supabase
      .from("tenants")
      .select("distro_name, phone_number")
      .eq("id", run.tenant_id)
      .single();

    const pdfStream = await renderToStream(
      PayslipDocument({
        run: {
          id: run.id,
          salary_month: run.salary_month,
          working_days: run.working_days,
          basic_salary: Number(run.basic_salary || 0),
          bonus_amount: Number(run.bonus_amount || 0),
          absent_deduction: Number(run.absent_deduction || 0),
          sop_violation_deduction: Number(run.sop_violation_deduction || 0),
          net_salary: Number(run.net_salary || 0),
          loan_installment_due: Number(run.loan_installment_due || 0),
          loan_installment_applied: Number(run.loan_installment_applied || 0),
          net_payable: Number(run.net_payable || 0),
          balance_carried: Number(run.balance_carried || 0),
          operator: run.operator,
          computer_voucher: run.computer_voucher,
          created_at: run.created_at,
        },
        employee: run.employee || { full_name: "Unknown" },
        sop: run.sop || null,
        loan: run.loan ? {
          id: run.loan.id,
          principal_amount: Number(run.loan.principal_amount || 0),
          outstanding_balance: Number(run.loan.outstanding_balance || 0),
          installment_cap_pct: Number(run.loan.installment_cap_pct || 30),
          status: run.loan.status,
          override_reason: run.loan.override_reason,
        } : null,
        distributor: {
          name: tenant?.distro_name || "MDOS Distributor",
          address: tenant?.phone_number ? `Contact: ${tenant.phone_number}` : "",
        },
      })
    );

    const empCode = run.employee?.employee_code || run.employee?.full_name || "emp";
    const filename = `Payslip_${empCode}_${run.salary_month?.slice(0, 7)}.pdf`;

    return new NextResponse(pdfStream as any, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
      },
    });
  } catch (err: any) {
    console.error("[Payslip API Error]", err);
    return new NextResponse(err?.message || "Internal Server Error", { status: 500 });
  }
}
