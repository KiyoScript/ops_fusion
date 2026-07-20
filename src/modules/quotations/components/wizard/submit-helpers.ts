import { toast } from "sonner";
import { createInquiryAction } from "@/app/(app)/inquiries/actions";
import { createQuotationAction } from "@/app/(app)/quotations/actions";
import { isValidPhContact } from "@/components/validated-fields";
import type { QuotationCreateInput } from "../../schemas/quotation";

type QuotationPayload = Omit<QuotationCreateInput, "inquiryId">;

/** Optionally logs an Inquiry first (from the wizard's client info), then
 *  creates the quotation linked to it — so "Log inquiry + quote" leaves a
 *  QUOTED inquiry trail, while "Create quotation" alone does not. */
export async function submitWizardQuotation(
  payload: QuotationPayload,
  opts: {
    /** Existing inquiry to link (wizard opened from /inquiries). */
    existingInquiryId?: string;
    /** When set, log a NEW inquiry from these fields and link the quote. */
    inquiry?: {
      customerName: string;
      contactNumber?: string;
      email?: string;
      servicesRequested: string;
    };
  } = {}
): Promise<{ id: string; quoteNumber: string } | null> {
  let inquiryId: string | undefined = opts.existingInquiryId;

  if (opts.inquiry) {
    const inqResult = await createInquiryAction({
      customerName: opts.inquiry.customerName,
      contactNumber: opts.inquiry.contactNumber || undefined,
      email: opts.inquiry.email || undefined,
      medium: "WALK_IN",
      servicesRequested: opts.inquiry.servicesRequested,
    });
    if (!inqResult.ok) {
      toast.error(inqResult.error);
      return null;
    }
    inquiryId = inqResult.data.id;
  }

  // Customer enrichment is best-effort — a half-typed contact/email must
  // never block the quote, so invalid values are dropped here.
  const result = await createQuotationAction({
    ...payload,
    contactNumber:
      payload.contactNumber && isValidPhContact(payload.contactNumber)
        ? payload.contactNumber
        : undefined,
    email:
      payload.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)
        ? payload.email
        : undefined,
    inquiryId,
  });
  if (!result.ok) {
    toast.error(result.error);
    return null;
  }
  return result.data as { id: string; quoteNumber: string };
}
