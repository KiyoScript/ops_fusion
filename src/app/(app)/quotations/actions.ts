"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/authz";
import { fail, ok, ValidationError, type ActionResult } from "@/lib/errors";
import { getQuotationService } from "@/modules/quotations/services";
import {
  quotationCreateInput,
  quotationTransitionInput,
  quotationUpdateInput,
} from "@/modules/quotations/schemas/quotation";
import { z } from "zod";

function firstIssue(error: z.ZodError): ValidationError {
  return new ValidationError(error.issues[0]?.message ?? "Invalid input.");
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
