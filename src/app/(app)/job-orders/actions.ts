"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/authz";
import { fail, ok, ValidationError, type ActionResult } from "@/lib/errors";
import { getJobOrderService } from "@/modules/job-orders/services";
import {
  itemEditInput,
  itemStatusUpdateInput,
  jobOrderCreateInput,
  jobOrderUpdateInput,
  moveDeadlineInput,
} from "@/modules/job-orders/schemas/job-order";
import { z } from "zod";

function firstIssue(error: z.ZodError): ValidationError {
  return new ValidationError(error.issues[0]?.message ?? "Invalid input.");
}

export async function createJobOrderAction(
  input: unknown
): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const parsed = jobOrderCreateInput.safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));

    const result = await getJobOrderService().create(actor, parsed.data);
    revalidatePath("/job-orders");
    return ok(result);
  } catch (err) {
    return fail(err);
  }
}

export async function updateJobOrderAction(
  input: unknown
): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const parsed = jobOrderUpdateInput.safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));

    await getJobOrderService().update(actor, parsed.data);
    revalidatePath("/job-orders");
    revalidatePath(`/job-orders/${parsed.data.id}`);
    return ok({ id: parsed.data.id });
  } catch (err) {
    return fail(err);
  }
}

export async function updateItemStatusAction(
  input: unknown
): Promise<ActionResult<null>> {
  try {
    const actor = await requireActor();
    const parsed = itemStatusUpdateInput.safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));

    await getJobOrderService().updateItemStatus(actor, parsed.data);
    revalidatePath("/job-orders");
    revalidatePath(`/job-orders/${parsed.data.jobOrderId}`);
    return ok(null);
  } catch (err) {
    return fail(err);
  }
}

export async function updateItemAction(
  input: unknown
): Promise<ActionResult<null>> {
  try {
    const actor = await requireActor();
    const parsed = itemEditInput.safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));

    await getJobOrderService().updateItem(actor, parsed.data);
    revalidatePath("/job-orders");
    return ok(null);
  } catch (err) {
    return fail(err);
  }
}

export async function moveJoDeadlineAction(
  input: unknown
): Promise<ActionResult<{ itemsMoved: number }>> {
  try {
    const actor = await requireActor();
    const parsed = moveDeadlineInput.safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));

    const result = await getJobOrderService().moveJoDeadline(actor, parsed.data);
    revalidatePath("/job-orders");
    return ok(result);
  } catch (err) {
    return fail(err);
  }
}

export async function archiveJobOrderAction(
  input: unknown
): Promise<ActionResult<null>> {
  try {
    const actor = await requireActor();
    const parsed = z.object({ id: z.string().min(1) }).safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));

    await getJobOrderService().archiveJo(actor, parsed.data.id);
    revalidatePath("/job-orders");
    return ok(null);
  } catch (err) {
    return fail(err);
  }
}
