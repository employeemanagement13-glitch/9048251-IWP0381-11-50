import { getDailySummary } from "@/lib/actions/cash";
import { DailySummaryClient } from "./DailySummaryClient";
import { PageHeader } from "@/components/layout/PageHeader";

export const metadata = { title: "Daily Summary" };

interface PageProps {
  searchParams: Promise<{ date?: string }>;
}

export default async function DailySummaryPage({ searchParams }: PageProps) {
  const { date } = await searchParams;
  const targetDate = date || new Date().toISOString().split("T")[0];
  const summary = await getDailySummary(targetDate);

  return (
    <div className="p-6">
      <PageHeader
        title="Daily Summary"
        subtitle="Tab 4, Page 1 — Daily Delivery Man performance and cash submission summary"
      />
      <DailySummaryClient initialSummary={summary} currentDate={targetDate} />
    </div>
  );
}

