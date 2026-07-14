"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/authz";
import { fail, ok, ValidationError, type ActionResult } from "@/lib/errors";
import { getInquiryService } from "@/modules/quotations/services";
import {
  inquiryCreateInput,
  inquiryUpdateInput,
} from "@/modules/quotations/schemas/inquiry";
import { z } from "zod";

function firstIssue(error: z.ZodError): ValidationError {
  return new ValidationError(error.issues[0]?.message ?? "Invalid input.");
}

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
