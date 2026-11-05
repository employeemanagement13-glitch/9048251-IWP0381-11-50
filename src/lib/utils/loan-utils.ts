export function isLoanUnrecoverable(loan: any): boolean {
  if (!loan) return false;
  if (loan.is_unrecoverable === true || loan.is_unrecoverable === "true") return true;
  if (typeof loan.override_reason === "string" && loan.override_reason.includes("[unrecoverable:true]")) return true;
  return false;
}
