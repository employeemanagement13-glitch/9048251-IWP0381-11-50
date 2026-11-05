import { getEmployees } from "@/lib/actions/employees";
import { getDmRoutes, getLoaders } from "@/lib/actions/routes";
import { getSalaryHeadView } from "@/lib/actions/payroll";
import { getFuelEntries } from "@/lib/actions/fuel";
import { getMaintenanceEntries } from "@/lib/actions/maintenance";
import { getBills, getEntertainment, getPetty, getPenalties } from "@/lib/actions/expenses";
import { getBankAccounts, getVendorAccounts } from "@/lib/actions/bank-accounts";
import { getLaborers, getLaborerExpenses } from "@/lib/actions/laborers";
import { AgencyExpensesClient } from "./AgencyExpensesClient";

export const metadata = { title: "Agency Expenses" };

export default async function AgencyExpensesPage() {
  const [
    employees, dmRoutes, loaders, salaryRows, fuelEntries, maintenanceEntries,
    billsRows, entertainmentRows, pettyRows, penaltiesRows, bankAccounts, vendorAccounts,
    laborers, laborerExpenses,
  ] = await Promise.all([
    getEmployees(),
    getDmRoutes(),
    getLoaders(),
    getSalaryHeadView(),
    getFuelEntries(),
    getMaintenanceEntries(),
    getBills(),
    getEntertainment(),
    getPetty(),
    getPenalties(),
    getBankAccounts(),
    getVendorAccounts(),
    getLaborers(),
    getLaborerExpenses(),
  ]);

  return (
    <AgencyExpensesClient
      employees={employees}
      dmRoutes={dmRoutes}
      loaders={loaders}
      salaryRows={salaryRows}
      fuelEntries={fuelEntries}
      maintenanceEntries={maintenanceEntries}
      billsRows={billsRows}
      entertainmentRows={entertainmentRows}
      pettyRows={pettyRows}
      penaltiesRows={penaltiesRows}
      bankAccounts={bankAccounts}
      vendorAccounts={vendorAccounts}
      laborers={laborers}
      laborerExpenses={laborerExpenses}
    />
  );
}

