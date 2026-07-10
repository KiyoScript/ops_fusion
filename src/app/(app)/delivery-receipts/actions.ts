"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/lib/authz";
import { fail, ok, ValidationError, type ActionResult } from "@/lib/errors";
import { getDeliveryReceiptService } from "@/modules/delivery-receipts/services";
import { issueDrInput } from "@/modules/delivery-receipts/schemas/delivery-receipt";

function firstIssue(error: z.ZodError): ValidationError {
  return new ValidationError(error.issues[0]?.message ?? "Invalid input.");
}

export async function issueDrAction(
  input: unknown
): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const parsed = issueDrInput.safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));

    const result = await getDeliveryReceiptService().issue(actor, parsed.data);
    revalidatePath("/delivery-receipts");
    return ok(result);
  } catch (err) {
    return fail(err);
  }
}

export async function cancelDrAction(
  input: unknown
): Promise<ActionResult<null>> {
  try {
    const actor = await requireActor();
    const parsed = z.object({ id: z.string().min(1) }).safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));

    await getDeliveryReceiptService().cancel(actor, parsed.data.id);
    revalidatePath("/delivery-receipts");
    return ok(null);
  } catch (err) {
    return fail(err);
  }
}
