import type { Metadata } from "next";
import { requireActor } from "@/lib/authz";
import { PageHeader } from "@/components/page-header";
import { SalesReportView } from "@/modules/sales-audit/components/sales-report-view";

export const metadata: Metadata = { title: "Sales Report" };

export default async function SalesReportPage() {
  await requireActor();

  return (
    <>
      <PageHeader
        title="Sales Report"
        description="What we sold over any range of dates — split VAT and Non-VAT, by period and by customer, with cash collected reported beside it rather than inside it."
      />
      <SalesReportView />
    </>
  );
}
