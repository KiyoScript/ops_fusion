import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/authz";
import { defineAbilityFor } from "@/lib/ability";
import { NotFoundError } from "@/lib/errors";
import { PageHeader } from "@/components/page-header";
import { BackButton } from "@/components/back-button";
import { getInquiryService } from "@/modules/quotations/services";
import type { QuotationCreateInput } from "@/modules/quotations/schemas/quotation";
import { QuotationForm } from "@/modules/quotations/components/quotation-form";

export const metadata: Metadata = { title: "Edit Inquiry" };

// Editing an inquiry opens the FULL quote form (same fields as New Quotation),
// pre-filled from its draft snapshot. Saving updates the inquiry — it stays an
// inquiry, no quotation is created.
export default async function EditInquiryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireActor();
  if (defineAbilityFor(actor).cannot("update", "Inquiry")) redirect("/inquiries");

  let inquiry;
  try {
    inquiry = await getInquiryService().get(actor, id);
  } catch (err) {
    if (err instanceof NotFoundError) redirect("/inquiries");
    throw err;
  }
  // Already converted — edit the quote itself, not the inquiry.
  if (inquiry.quotationId) redirect(`/quotations/${inquiry.quotationId}`);

  const draft = await getInquiryService().getDraft(actor, id);
  const initialValues: QuotationCreateInput =
    draft && typeof draft === "object"
      ? (draft as QuotationCreateInput)
      : {
          type: "SALES",
          poNumber: "",
          customerName: inquiry.customerName,
          contactNumber: inquiry.contactNumber ?? "",
          validUntil: "",
          taxType: "NON_VAT",
          paymentTermLabel: "50% Downpayment",
          downpaymentRate: "0.5",
          discount: "",
          notes: inquiry.notes ?? "",
          items: [
            {
              productId: "",
              description: inquiry.servicesRequested,
              qty: "1",
              unitPrice: "",
              discount: "",
            },
          ],
        };

  return (
    <>
      <BackButton fallbackHref="/inquiries" label="Inquiries" />
      <PageHeader
        title="Edit inquiry"
        description={`Editing ${inquiry.customerName}'s inquiry — full details, saved as an inquiry (not a quote).`}
      />
      <QuotationForm
        mode="edit-inquiry"
        inquiryId={id}
        initialValues={initialValues}
        initialMedium={inquiry.medium}
      />
    </>
  );
}
