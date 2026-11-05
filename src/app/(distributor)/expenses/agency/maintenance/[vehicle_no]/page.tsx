import { getMaintenanceEntries, getDriverForVehicle } from "@/lib/actions/maintenance";
import { getBankAccounts } from "@/lib/actions/bank-accounts";
import { VehicleMaintenanceClient } from "./VehicleMaintenanceClient";

interface Props {
  params: Promise<{ vehicle_no: string }>;
  searchParams: Promise<{ from?: string; to?: string; name?: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { vehicle_no } = await params;
  return { title: `Maintenance — ${decodeURIComponent(vehicle_no)}` };
}

export default async function VehicleMaintenancePage({ params, searchParams }: Props) {
  const { vehicle_no } = await params;
  const { from, to, name } = await searchParams;
  const decodedVehicle = decodeURIComponent(vehicle_no);

  const [entries, bankAccounts, defaultDriver] = await Promise.all([
    getMaintenanceEntries({ vehicle_no: decodedVehicle }),
    getBankAccounts(),
    name ? Promise.resolve(name) : getDriverForVehicle(decodedVehicle),
  ]);

  return (
    <VehicleMaintenanceClient
      vehicleNo={decodedVehicle}
      initialFrom={from || ""}
      initialTo={to || ""}
      initialEntries={entries}
      bankAccounts={bankAccounts}
      defaultDriver={defaultDriver}
    />
  );
}
