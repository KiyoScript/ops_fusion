"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/authz";
import { fail, ok, ValidationError, type ActionResult } from "@/lib/errors";
import { getInquiryService } from "@/modules/quotations/services";
import {
  inquiryCloseInput,
  inquiryCreateInput,
  inquiryUpdateInput,
} from "@/modules/quotations/schemas/inquiry";
import type { Prisma } from "@/generated/prisma/client";
import { z } from "zod";

function firstIssue(error: z.ZodError): ValidationError {
  return new ValidationError(error.issues[0]?.message ?? "Invalid input.");
}

// "Log inquiry instead" from the quote form (Option B): the inquiry essentials
// are validated, and the full form snapshot rides along as an opaque `draft`
// (prices may be blank — it isn't a quotation yet, so it skips quote validation;
// it's re-validated only when actually converted to a quote later).
const logInquiryDraftInput = z.object({
  customerName: z.string().trim().min(1, "Customer is required.").max(200),
  contactNumber: z.string().trim().min(1, "Contact number is required.").max(40),
  medium: z.enum(["MESSENGER", "EMAIL", "WALK_IN", "CALL", "VIBER", "PORTAL"]),
  servicesRequested: z
    .string()
    .trim()
    .min(1, "Add at least one item — what is the customer asking for?")
    .max(1000),
  notes: z.string().trim().max(2000).optional(),
  draft: z.record(z.string(), z.unknown()),
});

export async function createInquiryAction(
  input: unknown
): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const parsed = inquiryCreateInput.safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));

    const result = await getInquiryService().create(actor, parsed.data);
    revalidatePath("/inquiries");
    return ok(result);
  } catch (err) {
    return fail(err);
  }
}

export async function logInquiryDraftAction(
  input: unknown
): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const parsed = logInquiryDraftInput.safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));
    const created = await getInquiryService().logDraft(actor, {
      customerName: parsed.data.customerName,
      contactNumber: parsed.data.contactNumber,
      medium: parsed.data.medium,
      servicesRequested: parsed.data.servicesRequested,
      notes: parsed.data.notes ?? null,
      draft: parsed.data.draft as Prisma.InputJsonValue,
    });
    revalidatePath("/inquiries");
    return ok(created);
  } catch (err) {
    return fail(err);
  }
}

export async function updateInquiryAction(
  input: unknown
): Promise<ActionResult<null>> {
  try {
    const actor = await requireActor();
    const parsed = inquiryUpdateInput.safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));

    await getInquiryService().update(actor, parsed.data);
    revalidatePath("/inquiries");
    return ok(null);
  } catch (err) {
    return fail(err);
  }
}

// Edit an inquiry in the FULL quote form (same fields as New Quotation). Same
// lenient shape as logging, plus the id — persists the edited draft snapshot.
const updateInquiryDraftInput = logInquiryDraftInput.extend({
  id: z.string().min(1),
});

export async function updateInquiryDraftAction(
  input: unknown
): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const parsed = updateInquiryDraftInput.safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));
    await getInquiryService().updateDraft(actor, parsed.data.id, {
      customerName: parsed.data.customerName,
      contactNumber: parsed.data.contactNumber,
      medium: parsed.data.medium,
      servicesRequested: parsed.data.servicesRequested,
      notes: parsed.data.notes ?? null,
      draft: parsed.data.draft as Prisma.InputJsonValue,
    });
    revalidatePath("/inquiries");
    return ok({ id: parsed.data.id });
  } catch (err) {
    return fail(err);
  }
}

export async function closeInquiryAction(
  input: unknown
): Promise<ActionResult<null>> {
  try {
    const actor = await requireActor();
    const parsed = inquiryCloseInput.safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));

    await getInquiryService().close(actor, parsed.data);
    revalidatePath("/inquiries");
    return ok(null);
  } catch (err) {
    return fail(err);
  }
}

export async function reopenInquiryAction(
  id: string
): Promise<ActionResult<null>> {
  try {
    const actor = await requireActor();
    if (!id) return fail(new ValidationError("Missing inquiry id."));

    await getInquiryService().reopen(actor, id);
    revalidatePath("/inquiries");
    return ok(null);
  } catch (err) {
    return fail(err);
  }
}
