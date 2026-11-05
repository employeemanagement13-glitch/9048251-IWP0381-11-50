import { getFuelEntries, getDriverForTruck } from "@/lib/actions/fuel";
import { getBankAccounts } from "@/lib/actions/bank-accounts";
import { TruckFuelClient } from "./TruckFuelClient";

interface Props {
  params:      Promise<{ truck_no: string }>;
  searchParams: Promise<{ from?: string; to?: string; type?: string; name?: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { truck_no } = await params;
  return { title: `Fuel — ${decodeURIComponent(truck_no)}` };
}

export default async function TruckFuelPage({ params, searchParams }: Props) {
  const { truck_no }   = await params;
  const { from, to, type, name }   = await searchParams;
  const decodedTruck   = decodeURIComponent(truck_no);

  const [entries, bankAccounts, defaultDriver] = await Promise.all([
    getFuelEntries({ truck_no: decodedTruck }),
    getBankAccounts(),
    name ? Promise.resolve(name) : getDriverForTruck(decodedTruck),
  ]);

  const isLoader = type === "loader";

  return (
    <TruckFuelClient
      truckNo={decodedTruck}
      initialFrom={from || ""}
      initialTo={to   || ""}
      initialEntries={entries}
      bankAccounts={bankAccounts}
      defaultDriver={defaultDriver}
      isLoader={isLoader}
    />
  );
}

