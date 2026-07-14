import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/authz";
import { defineAbilityFor } from "@/lib/ability";
import { NotFoundError } from "@/lib/errors";
import { BackButton } from "@/components/back-button";
import { getInquiryService } from "@/modules/quotations/services";
import { resolveWizardProduct } from "@/modules/quotations/services/resolve-product";
import { TarpaulinWizard } from "@/modules/quotations/components/wizard/tarpaulin-wizard";

export const metadata: Metadata = { title: "Tarpaulin Quotation" };

export default async function TarpaulinWizardPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string; inquiryId?: string }>;
}) {
  const actor = await requireActor();
  if (defineAbilityFor(actor).cannot("create", "Quotation")) {
    redirect("/quotations");
  }

  const { product: productId, inquiryId } = await searchParams;
  const product = await resolveWizardProduct(productId, "Tarpaulin");
  if (!product) redirect("/quotations/new");

  if (inquiryId) {
    try {
      const inquiry = await getInquiryService().get(actor, inquiryId);
      if (inquiry.quotationId) redirect(`/quotations/${inquiry.quotationId}`);
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err;
    }
  }

  return (
    <>
      <BackButton fallbackHref="/quotations/new" label="Products" />
      <TarpaulinWizard product={product} inquiryId={inquiryId} />
    </>
  );
}
