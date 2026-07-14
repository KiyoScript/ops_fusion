import type { Metadata } from "next";
import { requireActor } from "@/lib/authz";
import { defineAbilityFor } from "@/lib/ability";
import { PageHeader } from "@/components/page-header";
import { QuotationsView } from "@/modules/quotations/components/quotations-view";

export const metadata: Metadata = { title: "Quotations" };

export default async function QuotationsPage() {
  const ability = defineAbilityFor(await requireActor());
  const canWrite = ability.can("create", "Quotation");

  return (
    <>
      <PageHeader
        title="Quotations"
        description="Quote creation, supervisor approval, and conversion to Job Orders — migrated from the legacy quotation system."
      />
      <QuotationsView canWrite={canWrite} />
    </>
  );
}
