"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/lib/authz";
import { fail, ok, ValidationError, type ActionResult } from "@/lib/errors";
import { getSupplierService } from "@/modules/inventory/services/supplier-service";
import { supplierInput } from "@/modules/inventory/schemas/material";

function firstIssue(error: z.ZodError): ValidationError {
  return new ValidationError(error.issues[0]?.message ?? "Invalid input.");
}
const withId = supplierInput.extend({ id: z.string().min(1) });

export async function createSupplierAction(
  input: unknown
): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const parsed = supplierInput.safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));
    const result = await getSupplierService().create(actor, parsed.data);
    revalidatePath("/maintenance/inventory");
    return ok(result);
  } catch (err) {
    return fail(err);
  }
}

export async function updateSupplierAction(
  input: unknown
): Promise<ActionResult<null>> {
  try {
    const actor = await requireActor();
    const parsed = withId.safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));
    const { id, ...data } = parsed.data;
    await getSupplierService().update(actor, id, data);
    revalidatePath("/maintenance/inventory");
    return ok(null);
  } catch (err) {
    return fail(err);
  }
}

export async function archiveSupplierAction(
  input: unknown
): Promise<ActionResult<null>> {
  try {
    const actor = await requireActor();
    const parsed = z.object({ id: z.string().min(1) }).safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));
    await getSupplierService().archive(actor, parsed.data.id);
    revalidatePath("/maintenance/inventory");
    return ok(null);
  } catch (err) {
    return fail(err);
  }
}
