import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireActor } from "@/lib/authz";
import { defineAbilityFor } from "@/lib/ability";
import { NotFoundError } from "@/lib/errors";
import { PageHeader } from "@/components/page-header";
import { BackButton } from "@/components/back-button";
import { getQuotationService } from "@/modules/quotations/services";
import type {
  QuotationCreateInput,
  QuotationDetailDto,
} from "@/modules/quotations/schemas/quotation";
import { QuotationForm } from "@/modules/quotations/components/quotation-form";

export const metadata: Metadata = { title: "Edit Quotation" };

const EDITABLE_STATUSES = ["DRAFT", "PENDING_APPROVAL", "REJECTED"];

export default async function EditQuotationPage({
  params,
}: {
  params: Promise<{ quotationId: string }>;
}) {
  const actor = await requireActor();
  const ability = defineAbilityFor(actor);
  if (ability.cannot("update", "Quotation")) redirect("/quotations");

  const { quotationId } = await params;
  let detail: QuotationDetailDto;
  try {
    detail = await getQuotationService().get(actor, quotationId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  if (!EDITABLE_STATUSES.includes(detail.status)) {
    redirect(`/quotations/${detail.id}`);
  }

  const initialValues: QuotationCreateInput = {
    customerName: detail.customer.name,
    validUntil: detail.validUntil ?? "",
    taxType: detail.totals.taxType as QuotationCreateInput["taxType"],
    paymentTermLabel: detail.totals.paymentTermLabel ?? "",
    downpaymentRate: detail.totals.downpaymentRate,
    discount: parseFloat(detail.totals.discount) > 0 ? detail.totals.discount : "",
    notes: detail.notes ?? "",
    items: detail.items.map((item) => ({
      id: item.id,
      productId: item.productId ?? undefined,
      description: item.description,
      qty: String(item.qty),
      unitPrice: item.unitPrice,
      discount: parseFloat(item.discount) > 0 ? item.discount : "",
      specs: item.specs ?? undefined,
    })),
  };

  return (
    <>
      <BackButton
        fallbackHref={`/quotations/${detail.id}`}
        label={detail.quoteNumber}
      />
      <PageHeader
        title={`Edit ${detail.quoteNumber}`}
        description={
          detail.status === "REJECTED"
            ? "Saving returns this rejected quotation to Draft for resubmission."
            : "Editable until the quotation is approved."
        }
      />
      <QuotationForm
        mode="edit"
        quotationId={detail.id}
        initialValues={initialValues}
      />
    </>
  );
}
