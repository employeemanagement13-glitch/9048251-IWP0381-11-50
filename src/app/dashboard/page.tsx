import { redirect } from "next/navigation";

export default function DashboardPage() {
  redirect("/tab1/invoices");
}

