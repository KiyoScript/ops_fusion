import type { Metadata } from "next";
import { requireActor } from "@/lib/authz";
import { defineAbilityFor } from "@/lib/ability";
import { PageHeader } from "@/components/page-header";
import { DrView } from "@/modules/delivery-receipts/components/dr-view";

export const metadata: Metadata = { title: "Delivery Receipts" };

export default async function DeliveryReceiptsPage() {
  const ability = defineAbilityFor(await requireActor());
  const canIssue = ability.can("issue", "DeliveryReceipt");
  const canCancel = ability.can("update", "DeliveryReceipt");

  return (
    <>
      <PageHeader
        title="Delivery Receipts"
        description="Issue delivery receipts per completed JO line item — partial quantities allowed."
      />
      <DrView canIssue={canIssue} canCancel={canCancel} />
    </>
  );
}
