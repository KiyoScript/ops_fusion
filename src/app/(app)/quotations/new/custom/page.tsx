import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/authz";
import { defineAbilityFor } from "@/lib/ability";
import { NotFoundError } from "@/lib/errors";
import { PageHeader } from "@/components/page-header";
import { BackButton } from "@/components/back-button";
import { getInquiryService } from "@/modules/quotations/services";
import type { QuotationCreateInput } from "@/modules/quotations/schemas/quotation";
import type { InquiryRowDto } from "@/modules/quotations/schemas/inquiry";
import { QuotationForm } from "@/modules/quotations/components/quotation-form";

export const metadata: Metadata = { title: "New Quotation" };

// The full multi-item quotation form — for custom lines and products
// without a guided wizard. Reachable from the product chooser.
export default async function CustomQuotationPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string; inquiryId?: string }>;
}) {
  const actor = await requireActor();
  if (defineAbilityFor(actor).cannot("create", "Quotation")) {
    redirect("/quotations");
  }

  const { product: productId, inquiryId } = await searchParams;

  let inquiry: InquiryRowDto | undefined;
  if (inquiryId) {
    try {
      inquiry = await getInquiryService().get(actor, inquiryId);
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err;
    }
    if (inquiry?.quotationId) redirect(`/quotations/${inquiry.quotationId}`);
  }

  const firstItem = {
    productId: productId ?? "",
    description: inquiry?.servicesRequested ?? "",
    qty: "1",
    unitPrice: "",
    discount: "",
  };
  const initialValues: QuotationCreateInput | undefined =
    inquiry || productId
      ? {
          type: "SALES",
          poNumber: "",
          customerName: inquiry?.customerName ?? "",
          validUntil: "",
          taxType: "NON_VAT",
          paymentTermLabel: "50% Downpayment",
          downpaymentRate: "0.5",
          discount: "",
          notes: inquiry?.notes ?? "",
          items: [firstItem],
        }
      : undefined;

  return (
    <>
      <BackButton fallbackHref="/quotations/new" label="Products" />
      <PageHeader
        title="New Quotation"
        description={
          inquiry
            ? `Drafting from ${inquiry.customerName}'s inquiry — saving links the inquiry to this quote.`
            : "Add line items, set tax and payment terms, then create the draft."
        }
      />
      <QuotationForm
        mode="create"
        initialValues={initialValues}
        inquiryId={inquiry?.id}
      />
    </>
  );
}
