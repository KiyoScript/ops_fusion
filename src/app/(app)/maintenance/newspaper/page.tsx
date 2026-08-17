import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/authz";
import { defineAbilityFor } from "@/lib/ability";
import { PageHeader } from "@/components/page-header";
import { getNewspaperMaintenance } from "@/modules/quotations/services/newspaper-pricing";
import { NewspaperPricingView } from "@/modules/quotations/components/newspaper-pricing-view";

export const metadata: Metadata = { title: "Newspaper Pricing" };

export default async function NewspaperPricingPage() {
  const actor = await requireActor();
  if (defineAbilityFor(actor).cannot("maintain", "Maintenance")) {
    redirect("/quotations");
  }
  const data = await getNewspaperMaintenance();

  return (
    <>
      <PageHeader
        title="Newspaper Pricing"
        description="Calculate a price, manage publication price tables, and approve submitted price changes."
      />
      <NewspaperPricingView {...data} />
    </>
  );
}
