"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/authz";
import { assertCan } from "@/lib/ability";
import { fail, ok, ValidationError, type ActionResult } from "@/lib/errors";
import { getQuotationService } from "@/modules/quotations/services";
import { saveTemplateRow } from "@/modules/quotations/services/newspaper-pricing";
import { renderQuotationPdf } from "@/modules/quotations/services/quotation-pdf";
import { sendMail, isMailConfigured } from "@/lib/mailer";
import {
  quotationCreateInput,
  quotationTransitionInput,
  quotationUpdateInput,
} from "@/modules/quotations/schemas/quotation";
import { z } from "zod";

function firstIssue(error: z.ZodError): ValidationError {
  return new ValidationError(error.issues[0]?.message ?? "Invalid input.");
}

// "Add to Template" — save the current formula-computed newspaper price as a
// reusable row (recomputed server-side). Part of quoting → gated on create.
const newspaperTemplateInput = z.object({
  publicationId: z.string().min(1),
  kind: z.enum(["FULL_ISSUE", "LOOSE_PAGES"]),
  colorPages: z.coerce.number().int().min(0).max(200),
  bwPages: z.coerce.number().int().min(0).max(200),
  copies: z.coerce.number().int().min(1).max(100000),
});

export async function addNewspaperTemplateAction(
  input: unknown
): Promise<ActionResult<{ price: number; created: boolean }>> {
  try {
    const actor = await requireActor();
    assertCan(actor, "create", "Quotation");
    const parsed = newspaperTemplateInput.safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));
    const { publicationId, kind, colorPages, bwPages, copies } = parsed.data;
    if (colorPages + bwPages <= 0) {
      return fail(new ValidationError("Enter the color / BW page counts."));
    }
    const result = await saveTemplateRow(
      { publicationId, kind, totalPages: colorPages + bwPages, colorPages, bwPages, copies },
      actor.id
    );
    return ok({ price: result.price, created: result.created });
  } catch (err) {
    return fail(err);
  }
}

export async function createQuotationAction(
  input: unknown
): Promise<ActionResult<{ id: string; quoteNumber: string }>> {
  try {
    const actor = await requireActor();
    const parsed = quotationCreateInput.safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));

    const result = await getQuotationService().create(actor, parsed.data);
    revalidatePath("/quotations");
    return ok(result);
  } catch (err) {
    return fail(err);
  }
}

export async function updateQuotationAction(
  input: unknown
): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const parsed = quotationUpdateInput.safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));

    await getQuotationService().update(actor, parsed.data);
    revalidatePath("/quotations");
    revalidatePath(`/quotations/${parsed.data.id}`);
    return ok({ id: parsed.data.id });
  } catch (err) {
    return fail(err);
  }
}

export async function transitionQuotationAction(
  input: unknown
): Promise<ActionResult<null>> {
  try {
    const actor = await requireActor();
    const parsed = quotationTransitionInput.safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));

    await getQuotationService().transition(actor, parsed.data);
    revalidatePath("/quotations");
    revalidatePath(`/quotations/${parsed.data.id}`);
    return ok(null);
  } catch (err) {
    return fail(err);
  }
}

export async function convertQuotationAction(
  id: string
): Promise<ActionResult<{ jobOrderId: string; joNumber: string }>> {
  try {
    const actor = await requireActor();
    if (!id) return fail(new ValidationError("Missing quotation id."));

    const result = await getQuotationService().convertToJobOrder(actor, id);
    revalidatePath("/quotations");
    revalidatePath(`/quotations/${id}`);
    revalidatePath("/job-orders");
    return ok(result);
  } catch (err) {
    return fail(err);
  }
}

export async function archiveQuotationAction(
  id: string
): Promise<ActionResult<null>> {
  try {
    const actor = await requireActor();
    if (!id) return fail(new ValidationError("Missing quotation id."));

    await getQuotationService().archive(actor, id);
    revalidatePath("/quotations");
    return ok(null);
  } catch (err) {
    return fail(err);
  }
}

// Email the quotation with the PDF attached. Subject/body are editable client-
// side (prefilled from buildQuoteEmail). Gated on the same "send" ability as the
// mark-as-sent transition; reads the quote through the service (auth + filters).
const sendEmailInput = z.object({
  id: z.string().min(1),
  to: z.string().trim().email("Enter a valid email address."),
  subject: z.string().trim().min(1, "Subject is required.").max(200),
  body: z.string().trim().min(1, "Body is required.").max(8000),
});

export async function sendQuotationEmailAction(
  input: unknown
): Promise<ActionResult<null>> {
  try {
    const actor = await requireActor();
    assertCan(actor, "send", "Quotation");
    const parsed = sendEmailInput.safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));
    if (!isMailConfigured()) {
      return fail(
        new ValidationError(
          "Email isn't set up yet — add SMTP_URL and MAIL_FROM to .env (Gmail app password), then restart."
        )
      );
    }
    const quote = await getQuotationService().get(actor, parsed.data.id);
    const pdf = await renderQuotationPdf(quote);
    const sent = await sendMail({
      to: parsed.data.to,
      subject: parsed.data.subject,
      text: parsed.data.body,
      attachments: [
        {
          filename: `${quote.quoteNumber}.pdf`,
          content: pdf,
          contentType: "application/pdf",
        },
      ],
    });
    if (!sent) {
      return fail(
        new ValidationError("Email failed to send — check the SMTP settings.")
      );
    }
    return ok(null);
  } catch (err) {
    return fail(err);
  }
}
