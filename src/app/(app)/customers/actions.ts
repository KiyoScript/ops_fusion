"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/authz";
import { fail, ok, ValidationError, type ActionResult } from "@/lib/errors";
import { getCustomerDirectoryService } from "@/modules/customers/services/customer-directory-service";
import { customerUpdateInput } from "@/modules/customers/schemas/customer";

export async function updateCustomerAction(
  input: unknown
): Promise<ActionResult<null>> {
  try {
    const actor = await requireActor();
    const parsed = customerUpdateInput.safeParse(input);
    if (!parsed.success) {
      return fail(new ValidationError(parsed.error.issues[0]?.message ?? "Invalid input."));
    }
    await getCustomerDirectoryService().update(actor, parsed.data);
    revalidatePath("/customers");
    revalidatePath(`/customers/${parsed.data.id}`);
    return ok(null);
  } catch (err) {
    return fail(err);
  }
}
