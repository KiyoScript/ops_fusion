import type { Metadata } from "next";
import { requireActor } from "@/lib/authz";
import { defineAbilityFor } from "@/lib/ability";
import { PageHeader } from "@/components/page-header";
import { BookletManager } from "@/modules/sales-audit/components/booklet-manager";

export const metadata: Metadata = { title: "Sales Audit Maintenance" };

export default async function SalesAuditMaintenancePage() {
  const ability = defineAbilityFor(await requireActor());
  const canApprove = ability.can("approve", "Booklet");

  return (
    <>
      <PageHeader
        title="Sales Audit Maintenance"
        description="The booklet register behind every receipt number — the new home of the legacy Doc_Series sheet."
      />
      <div className="grid gap-6">
        <BookletManager canApprove={canApprove} />
      </div>
    </>
  );
}
