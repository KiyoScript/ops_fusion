import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/authz";
import { defineAbilityFor } from "@/lib/ability";
import { PageHeader } from "@/components/page-header";
import { BackButton } from "@/components/back-button";
import { ProductChooser } from "@/modules/quotations/components/wizard/product-chooser";

export const metadata: Metadata = { title: "New Quotation" };

// Landing: pick a product. Products with a guided calculator open their
// step-by-step wizard; everything else opens the full quotation form.
export default async function NewQuotationPage({
  searchParams,
}: {
  searchParams: Promise<{ inquiryId?: string }>;
}) {
  const ability = defineAbilityFor(await requireActor());
  if (ability.cannot("create", "Quotation")) redirect("/quotations");

  const { inquiryId } = await searchParams;

  return (
    <>
      <BackButton
        fallbackHref={inquiryId ? "/inquiries" : "/quotations"}
        label={inquiryId ? "Inquiries" : "Quotations"}
      />
      <PageHeader
        title="New Quotation"
        description="Choose what to quote — guided calculators walk you through the specs step by step."
      />
      <ProductChooser inquiryId={inquiryId} />
    </>
  );
}
