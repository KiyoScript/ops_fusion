"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/authz";
import { fail, ok, ValidationError, type ActionResult } from "@/lib/errors";
import {
  getPriceListService,
  getProductionStepService,
} from "@/modules/quotations/services";
import {
  productionStepsSaveInput,
  productSaveInput,
} from "@/modules/quotations/schemas/price-list";
import { z } from "zod";

function firstIssue(error: z.ZodError): ValidationError {
  return new ValidationError(error.issues[0]?.message ?? "Invalid input.");
}

export async function savePriceListProductAction(
  input: unknown
): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const parsed = productSaveInput.safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));

    const result = await getPriceListService().saveProduct(actor, parsed.data);
    revalidatePath("/maintenance/quotations");
    return ok(result);
  } catch (err) {
    return fail(err);
  }
}

export async function archivePriceListProductAction(
  id: string
): Promise<ActionResult<null>> {
  try {
    const actor = await requireActor();
    if (!id) return fail(new ValidationError("Missing product id."));

    await getPriceListService().archiveProduct(actor, id);
    revalidatePath("/maintenance/quotations");
    return ok(null);
  } catch (err) {
    return fail(err);
  }
}

export async function saveProductionStepsAction(
  input: unknown
): Promise<ActionResult<null>> {
  try {
    const actor = await requireActor();
    const parsed = productionStepsSaveInput.safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));

    await getProductionStepService().save(actor, parsed.data);
    revalidatePath("/maintenance/quotations");
    return ok(null);
  } catch (err) {
    return fail(err);
  }
}
