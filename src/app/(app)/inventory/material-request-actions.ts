"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/lib/authz";
import { fail, ok, ValidationError, type ActionResult } from "@/lib/errors";
import { getMaterialRequestService } from "@/modules/inventory/services/material-request-service";
import {
  mrDecisionInput,
  mrEditInput,
  mrReleaseInput,
  mrSubmitInput,
} from "@/modules/inventory/schemas/material-request";

function firstIssue(error: z.ZodError): ValidationError {
  return new ValidationError(error.issues[0]?.message ?? "Invalid input.");
}
const idInput = z.object({ id: z.string().min(1) });

export async function submitMrAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const parsed = mrSubmitInput.safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));
    const result = await getMaterialRequestService().submit(actor, parsed.data);
    revalidatePath("/inventory");
    return ok(result);
  } catch (err) {
    return fail(err);
  }
}

export async function editMrAction(input: unknown): Promise<ActionResult<null>> {
  try {
    const actor = await requireActor();
    const parsed = mrEditInput.safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));
    await getMaterialRequestService().edit(actor, parsed.data);
    revalidatePath("/inventory");
    return ok(null);
  } catch (err) {
    return fail(err);
  }
}

export async function cancelMrAction(input: unknown): Promise<ActionResult<null>> {
  try {
    const actor = await requireActor();
    const parsed = idInput.safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));
    await getMaterialRequestService().cancel(actor, parsed.data.id);
    revalidatePath("/inventory");
    return ok(null);
  } catch (err) {
    return fail(err);
  }
}

export async function approveMrAction(input: unknown): Promise<ActionResult<null>> {
  try {
    const actor = await requireActor();
    const parsed = mrDecisionInput.safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));
    await getMaterialRequestService().approve(actor, parsed.data);
    revalidatePath("/inventory");
    return ok(null);
  } catch (err) {
    return fail(err);
  }
}

export async function rejectMrAction(input: unknown): Promise<ActionResult<null>> {
  try {
    const actor = await requireActor();
    const parsed = mrDecisionInput.safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));
    await getMaterialRequestService().reject(actor, parsed.data);
    revalidatePath("/inventory");
    return ok(null);
  } catch (err) {
    return fail(err);
  }
}

export async function releaseMrAction(input: unknown): Promise<ActionResult<null>> {
  try {
    const actor = await requireActor();
    const parsed = mrReleaseInput.safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));
    await getMaterialRequestService().release(actor, parsed.data);
    revalidatePath("/inventory");
    return ok(null);
  } catch (err) {
    return fail(err);
  }
}
