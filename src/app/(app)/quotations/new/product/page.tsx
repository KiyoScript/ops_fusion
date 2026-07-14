import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/authz";
import { defineAbilityFor } from "@/lib/ability";
import { NotFoundError } from "@/lib/errors";
import { BackButton } from "@/components/back-button";
import { getInquiryService } from "@/modules/quotations/services";
import { resolveWizardProduct } from "@/modules/quotations/services/resolve-product";
import { GenericWizard } from "@/modules/quotations/components/wizard/generic-wizard";

export const metadata: Metadata = { title: "New Quotation" };

// Generic guided wizard for any catalog product (Mug, Frame, Sticker, …).
// Tarpaulin and Signage have their own special routes.
export default async function GenericWizardPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string; inquiryId?: string }>;
}) {
  const actor = await requireActor();
  if (defineAbilityFor(actor).cannot("create", "Quotation")) {
    redirect("/quotations");
  }

  const { product: productId, inquiryId } = await searchParams;
  if (!productId) redirect("/quotations/new");
  const product = await resolveWizardProduct(productId, "");
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
      <GenericWizard product={product} inquiryId={inquiryId} />
    </>
  );
}
