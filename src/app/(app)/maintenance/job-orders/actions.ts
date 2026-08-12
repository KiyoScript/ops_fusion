"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/authz";
import { fail, ok, ValidationError, type ActionResult } from "@/lib/errors";
import { getLookupService } from "@/modules/shared/services/lookup-service";
import { getEmployeeService } from "@/modules/shared/services/employee-service";
import {
  lookupCreateInput,
  lookupDeleteInput,
  lookupUpdateInput,
  type LookupDto,
} from "@/modules/shared/schemas/lookup";
import {
  employeeCreateInput,
  employeeDeleteInput,
  employeeUpdateInput,
  type EmployeeDto,
} from "@/modules/shared/schemas/employee";
import { z } from "zod";

const PAGE = "/maintenance/job-orders";

function firstIssue(error: z.ZodError): ValidationError {
  return new ValidationError(error.issues[0]?.message ?? "Invalid input.");
}

export async function createLookupAction(
  input: unknown
): Promise<ActionResult<LookupDto>> {
  try {
    const actor = await requireActor();
    const parsed = lookupCreateInput.safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));
    const created = await getLookupService().create(actor, parsed.data);
    revalidatePath(PAGE);
    return ok(created);
  } catch (err) {
    return fail(err);
  }
}

export async function updateLookupAction(
  input: unknown
): Promise<ActionResult<null>> {
  try {
    const actor = await requireActor();
    const parsed = lookupUpdateInput.safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));
    await getLookupService().update(actor, parsed.data);
    revalidatePath(PAGE);
    return ok(null);
  } catch (err) {
    return fail(err);
  }
}

export async function deleteLookupAction(
  input: unknown
): Promise<ActionResult<null>> {
  try {
    const actor = await requireActor();
    const parsed = lookupDeleteInput.safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));
    await getLookupService().remove(actor, parsed.data.id);
    revalidatePath(PAGE);
    return ok(null);
  } catch (err) {
    return fail(err);
  }
}

export async function createEmployeeAction(
  input: unknown
): Promise<ActionResult<EmployeeDto>> {
  try {
    const actor = await requireActor();
    const parsed = employeeCreateInput.safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));
    const created = await getEmployeeService().create(actor, parsed.data);
    revalidatePath(PAGE);
    return ok(created);
  } catch (err) {
    return fail(err);
  }
}

export async function updateEmployeeAction(
  input: unknown
): Promise<ActionResult<null>> {
  try {
    const actor = await requireActor();
    const parsed = employeeUpdateInput.safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));
    await getEmployeeService().update(actor, parsed.data);
    revalidatePath(PAGE);
    return ok(null);
  } catch (err) {
    return fail(err);
  }
}

export async function deleteEmployeeAction(
  input: unknown
): Promise<ActionResult<null>> {
  try {
    const actor = await requireActor();
    const parsed = employeeDeleteInput.safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));
    await getEmployeeService().remove(actor, parsed.data.id);
    revalidatePath(PAGE);
    return ok(null);
  } catch (err) {
    return fail(err);
  }
}

