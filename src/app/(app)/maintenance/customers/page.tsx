import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/authz";
import { defineAbilityFor } from "@/lib/ability";
import { PageHeader } from "@/components/page-header";
import { getCreditTermService } from "@/modules/customers/services/credit-term-service";
import { CreditTermsManager } from "@/modules/customers/components/credit-terms-manager";

export const metadata: Metadata = { title: "Customer Maintenance" };

export default async function CustomerMaintenancePage() {
  const actor = await requireActor();
  if (defineAbilityFor(actor).cannot("maintain", "Maintenance")) {
    redirect("/customers");
  }
  const terms = await getCreditTermService().list(actor, true);

  return (
    <>
      <PageHeader
        title="Customer Maintenance"
        description="Reference lists behind the customer & company records."
      />
      <div className="max-w-xl">
        <CreditTermsManager terms={terms} />
      </div>
    </>
  );
}
