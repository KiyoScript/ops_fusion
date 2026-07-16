import type { Metadata } from "next";
import { requireActor } from "@/lib/authz";
import { defineAbilityFor } from "@/lib/ability";
import { PageHeader } from "@/components/page-header";
import { JobOrdersView } from "@/modules/job-orders/components/job-orders-view";

export const metadata: Metadata = { title: "Job Orders" };

export default async function JobOrdersPage() {
  const ability = defineAbilityFor(await requireActor());
  const canWrite = ability.can("create", "JobOrder");
  const canImport = ability.can("import", "JobOrder");
  // Cashiers issue receipts against a JO (Sales & Audit).
  const canReceivePayment = ability.can("create", "Sale");

  return (
    <>
      <PageHeader
        title="Job Orders"
        description="Track every JO and its line items through production — migrated from JOWebApp."
      />
      <JobOrdersView
        canWrite={canWrite}
        canImport={canImport}
        canReceivePayment={canReceivePayment}
      />
    </>
  );
}
