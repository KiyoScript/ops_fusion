"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/lib/authz";
import { fail, ok, ValidationError, type ActionResult } from "@/lib/errors";
import { getMaterialService } from "@/modules/inventory/services/material-service";
import { getStockAdjustmentService } from "@/modules/inventory/services/stock-adjustment-service";
import { getCycleCountService } from "@/modules/inventory/services/cycle-count-service";
import {
  materialInput,
  materialUpdateInput,
} from "@/modules/inventory/schemas/material";
import {
  adjustmentDecisionInput,
  adjustmentInput,
  cycleCountDecisionInput,
  cycleCountInput,
  cycleCountUpdateInput,
} from "@/modules/inventory/schemas/stock";

function firstIssue(error: z.ZodError): ValidationError {
  return new ValidationError(error.issues[0]?.message ?? "Invalid input.");
}
const idInput = z.object({ id: z.string().min(1) });

// ——— Item master ———

export async function createMaterialAction(
  input: unknown
): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const parsed = materialInput.safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));
    const result = await getMaterialService().create(actor, parsed.data);
    revalidatePath("/inventory");
    return ok(result);
  } catch (err) {
    return fail(err);
  }
}

export async function updateMaterialAction(
  input: unknown
): Promise<ActionResult<null>> {
  try {
    const actor = await requireActor();
    const parsed = materialUpdateInput.safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));
    await getMaterialService().update(actor, parsed.data);
    revalidatePath("/inventory");
    return ok(null);
  } catch (err) {
    return fail(err);
  }
}

export async function archiveMaterialAction(
  input: unknown
): Promise<ActionResult<null>> {
  try {
    const actor = await requireActor();
    const parsed = idInput.safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));
    await getMaterialService().archive(actor, parsed.data.id);
    revalidatePath("/inventory");
    return ok(null);
  } catch (err) {
    return fail(err);
  }
}

// ——— Stock adjustment ———

export async function requestAdjustmentAction(
  input: unknown
): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const parsed = adjustmentInput.safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));
    const result = await getStockAdjustmentService().request(actor, parsed.data);
    revalidatePath("/inventory");
    return ok(result);
  } catch (err) {
    return fail(err);
  }
}

export async function approveAdjustmentAction(
  input: unknown
): Promise<ActionResult<null>> {
  try {
    const actor = await requireActor();
    const parsed = adjustmentDecisionInput.safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));
    await getStockAdjustmentService().approve(actor, parsed.data);
    revalidatePath("/inventory");
    return ok(null);
  } catch (err) {
    return fail(err);
  }
}

export async function rejectAdjustmentAction(
  input: unknown
): Promise<ActionResult<null>> {
  try {
    const actor = await requireActor();
    const parsed = adjustmentDecisionInput.safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));
    await getStockAdjustmentService().reject(actor, parsed.data);
    revalidatePath("/inventory");
    return ok(null);
  } catch (err) {
    return fail(err);
  }
}

// ——— Cycle count ———

export async function createCycleCountAction(
  input: unknown
): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const parsed = cycleCountInput.safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));
    const result = await getCycleCountService().create(actor, parsed.data);
    revalidatePath("/inventory");
    return ok(result);
  } catch (err) {
    return fail(err);
  }
}

export async function updateCycleCountAction(
  input: unknown
): Promise<ActionResult<null>> {
  try {
    const actor = await requireActor();
    const parsed = cycleCountUpdateInput.safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));
    await getCycleCountService().update(actor, parsed.data);
    revalidatePath("/inventory");
    return ok(null);
  } catch (err) {
    return fail(err);
  }
}

export async function submitCycleCountAction(
  input: unknown
): Promise<ActionResult<null>> {
  try {
    const actor = await requireActor();
    const parsed = idInput.safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));
    await getCycleCountService().submit(actor, parsed.data.id);
    revalidatePath("/inventory");
    return ok(null);
  } catch (err) {
    return fail(err);
  }
}

export async function approveCycleCountAction(
  input: unknown
): Promise<ActionResult<null>> {
  try {
    const actor = await requireActor();
    const parsed = cycleCountDecisionInput.safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));
    await getCycleCountService().approve(actor, parsed.data);
    revalidatePath("/inventory");
    return ok(null);
  } catch (err) {
    return fail(err);
  }
}

export async function cancelCycleCountAction(
  input: unknown
): Promise<ActionResult<null>> {
  try {
    const actor = await requireActor();
    const parsed = idInput.safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));
    await getCycleCountService().cancel(actor, parsed.data.id);
    revalidatePath("/inventory");
    return ok(null);
  } catch (err) {
    return fail(err);
  }
}
