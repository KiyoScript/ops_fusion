import { toast } from "sonner";
import { createInquiryAction } from "@/app/(app)/inquiries/actions";
import { createQuotationAction } from "@/app/(app)/quotations/actions";
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

  const result = await createQuotationAction({ ...payload, inquiryId });
  if (!result.ok) {
    toast.error(result.error);
    return null;
  }
  return result.data as { id: string; quoteNumber: string };
}
