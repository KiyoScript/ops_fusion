"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/authz";
import { fail, ok, ValidationError, type ActionResult } from "@/lib/errors";
import { getCreditTermService } from "@/modules/customers/services/credit-term-service";

const PAGE = "/maintenance/customers";

export async function createCreditTermAction(
  days: unknown
): Promise<ActionResult<null>> {
  try {
    const actor = await requireActor();
    const n = Number(days);
    if (!Number.isFinite(n)) return fail(new ValidationError("Enter a number of days."));
    await getCreditTermService().create(actor, Math.trunc(n));
    revalidatePath(PAGE);
    return ok(null);
  } catch (err) {
    return fail(err);
  }
}

export async function toggleCreditTermAction(input: {
  id: string;
  isActive: boolean;
}): Promise<ActionResult<null>> {
  try {
    const actor = await requireActor();
    if (!input?.id) return fail(new ValidationError("Missing id."));
    await getCreditTermService().setActive(actor, input.id, input.isActive);
    revalidatePath(PAGE);
    return ok(null);
  } catch (err) {
    return fail(err);
  }
}

export async function deleteCreditTermAction(
  id: string
): Promise<ActionResult<null>> {
  try {
    const actor = await requireActor();
    if (!id) return fail(new ValidationError("Missing id."));
    await getCreditTermService().remove(actor, id);
    revalidatePath(PAGE);
    return ok(null);
  } catch (err) {
    return fail(err);
  }
}
