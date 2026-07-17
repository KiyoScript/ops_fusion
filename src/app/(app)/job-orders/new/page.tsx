import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/authz";
import { defineAbilityFor } from "@/lib/ability";
import { PageHeader } from "@/components/page-header";
import { BackButton } from "@/components/back-button";
import { JobOrderForm } from "@/modules/job-orders/components/job-order-form";

export const metadata: Metadata = { title: "New Non-JO" };

export default async function NewJobOrderPage() {
  const ability = defineAbilityFor(await requireActor());
  if (ability.cannot("create", "JobOrder")) redirect("/job-orders");

  return (
    <>
      <BackButton fallbackHref="/job-orders" label="Job Orders" />
      <PageHeader
        title="New Non-JO"
        description="Walk-in counter jobs — xerox, photocopies, supplies — with a manually typed reference number. Production JOs and POs are created from the Quotations module: approve the quote, then Convert."
      />
      <JobOrderForm mode="create" twoColumn />
    </>
  );
}
