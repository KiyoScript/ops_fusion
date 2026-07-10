import type { Metadata } from "next";
import { requireActor } from "@/lib/authz";
import { defineAbilityFor } from "@/lib/ability";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { ReportsView } from "@/modules/job-orders/components/reports-view";

export const metadata: Metadata = { title: "JO Reports" };

export default async function JoReportsPage() {
  const actor = await requireActor();
  // Any role that can read job orders may view reports (legacy 'view').
  if (defineAbilityFor(actor).cannot("read", "JobOrder")) redirect("/");

  return (
    <>
      <PageHeader
        title="JO Reports"
        description="End-of-day status summary and the JO report by department — as of a chosen date."
      />
      <ReportsView />
    </>
  );
}
