import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/authz";
import { defineAbilityFor } from "@/lib/ability";
import { PageHeader } from "@/components/page-header";
import { PriceListView } from "@/modules/quotations/components/price-list-view";

export const metadata: Metadata = { title: "Quotation Maintenance" };

export default async function QuotationMaintenancePage() {
  const actor = await requireActor();
  const ability = defineAbilityFor(actor);
  if (ability.cannot("read", "Maintenance")) redirect("/quotations");

  return (
    <>
      <PageHeader
        title="Quotation Maintenance"
        description="The price database behind the quote form — the new home of the legacy SignQuote price spreadsheet. Import the sheet to refresh products, variants, tiers, and add-on fees."
      />
      <PriceListView canMaintain={ability.can("maintain", "Maintenance")} />
    </>
  );
}
