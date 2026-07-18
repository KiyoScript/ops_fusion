"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/lib/authz";
import { fail, ok, ValidationError, type ActionResult } from "@/lib/errors";
import { getModuleFlagService } from "@/modules/shared/services/module-flag-service";

const input = z.object({
  key: z.string().min(1),
  enabled: z.boolean(),
});

export async function setModuleEnabledAction(
  raw: unknown
): Promise<ActionResult<null>> {
  try {
    const actor = await requireActor();
    const parsed = input.safeParse(raw);
    if (!parsed.success) {
      return fail(new ValidationError("Invalid input."));
    }
    await getModuleFlagService().setEnabled(
      actor,
      parsed.data.key,
      parsed.data.enabled
    );
    // A module going on/off changes the sidebar + route guard for everyone.
    revalidatePath("/", "layout");
    return ok(null);
  } catch (err) {
    return fail(err);
  }
}
