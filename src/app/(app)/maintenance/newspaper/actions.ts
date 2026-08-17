"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/lib/authz";
import { assertCan } from "@/lib/ability";
import { fail, ok, ValidationError, type ActionResult } from "@/lib/errors";
import {
  deleteNewspaperRow,
  createNewspaperRow,
  updateNewspaperRow,
  submitNewspaperPrice,
  approveNewspaperPrice,
  rejectNewspaperPrice,
  createNewspaperPublication,
  updateFormulaParams,
} from "@/modules/quotations/services/newspaper-pricing";

const paramsInput = z.object({
  pricePerPlate: z.coerce.number().min(0).max(1_000_000),
  laborPerPlate: z.coerce.number().min(0).max(1_000_000),
  paperRate: z.coerce.number().min(0).max(10_000),
  runningRate: z.coerce.number().min(0).max(1_000_000),
  marginPct: z.coerce.number().min(0).max(10), // fraction (0.5 = 50%)
});

export async function updateNewspaperFormulaParamsAction(
  input: unknown
): Promise<ActionResult<null>> {
  try {
    const actor = await requireActor();
    assertCan(actor, "maintain", "Maintenance");
    const parsed = paramsInput.safeParse(input);
    if (!parsed.success) {
      return fail(new ValidationError(parsed.error.issues[0]?.message ?? "Invalid input."));
    }
    await updateFormulaParams(parsed.data);
    revalidatePath("/maintenance/newspaper");
    return ok(null);
  } catch (err) {
    return fail(err);
  }
}

const rowInput = z.object({
  kind: z.enum(["FULL_ISSUE", "LOOSE_PAGES"]),
  colorPages: z.coerce.number().int().min(0).max(200),
  bwPages: z.coerce.number().int().min(0).max(200),
  copies: z.coerce.number().int().min(1).max(100000),
  price: z.coerce.number().min(0).max(10_000_000),
  priceCode: z.string().trim().max(60).optional(),
});

// Calculator submission: the user enters pages + colored; B/W is derived
// (pages − colored) and colored may not exceed pages.
const submissionInput = z
  .object({
    publicationId: z.string().min(1),
    kind: z.enum(["FULL_ISSUE", "LOOSE_PAGES"]),
    totalPages: z.coerce.number().int().min(1).max(1000),
    colorPages: z.coerce.number().int().min(0).max(1000),
    copies: z.coerce.number().int().min(1).max(100000),
    price: z.coerce.number().min(0).max(10_000_000),
    priceCode: z.string().trim().max(60).optional(),
  })
  .refine((v) => v.colorPages <= v.totalPages, {
    message: "Colored pages cannot exceed the number of pages.",
    path: ["colorPages"],
  });

export async function createNewspaperRowAction(
  input: unknown
): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    assertCan(actor, "maintain", "Maintenance");
    const schema = rowInput.extend({ publicationId: z.string().min(1) });
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      return fail(new ValidationError(parsed.error.issues[0]?.message ?? "Invalid input."));
    }
    if (parsed.data.colorPages + parsed.data.bwPages <= 0) {
      return fail(new ValidationError("Enter the color / BW page counts."));
    }
    const { publicationId, priceCode, ...rest } = parsed.data;
    const created = await createNewspaperRow(publicationId, {
      ...rest,
      priceCode: priceCode || null,
    });
    revalidatePath("/maintenance/newspaper");
    return ok(created);
  } catch (err) {
    return fail(err);
  }
}

export async function updateNewspaperRowAction(
  input: unknown
): Promise<ActionResult<null>> {
  try {
    const actor = await requireActor();
    assertCan(actor, "maintain", "Maintenance");
    const schema = rowInput.extend({ id: z.string().min(1) });
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      return fail(new ValidationError(parsed.error.issues[0]?.message ?? "Invalid input."));
    }
    if (parsed.data.colorPages + parsed.data.bwPages <= 0) {
      return fail(new ValidationError("Enter the color / BW page counts."));
    }
    const { id, priceCode, ...rest } = parsed.data;
    await updateNewspaperRow(id, { ...rest, priceCode: priceCode || null });
    revalidatePath("/maintenance/newspaper");
    return ok(null);
  } catch (err) {
    return fail(err);
  }
}

export async function deleteNewspaperRowAction(
  id: string
): Promise<ActionResult<null>> {
  try {
    const actor = await requireActor();
    assertCan(actor, "maintain", "Maintenance");
    if (!id) return fail(new ValidationError("Missing row id."));
    await deleteNewspaperRow(id);
    revalidatePath("/maintenance/newspaper");
    return ok(null);
  } catch (err) {
    return fail(err);
  }
}

// ─── Approval workflow ───────────────────────────────────────────────────────

export async function submitNewspaperPriceAction(
  input: unknown
): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    assertCan(actor, "maintain", "Maintenance");
    const parsed = submissionInput.safeParse(input);
    if (!parsed.success) {
      return fail(new ValidationError(parsed.error.issues[0]?.message ?? "Invalid input."));
    }
    const { publicationId, kind, totalPages, colorPages, copies, price, priceCode } =
      parsed.data;
    const created = await submitNewspaperPrice(
      {
        publicationId,
        kind,
        totalPages,
        colorPages,
        bwPages: totalPages - colorPages,
        copies,
        price,
        priceCode: priceCode || null,
      },
      actor.id
    );
    revalidatePath("/maintenance/newspaper");
    return ok(created);
  } catch (err) {
    return fail(err);
  }
}

export async function approveNewspaperPriceAction(
  id: string
): Promise<ActionResult<null>> {
  try {
    const actor = await requireActor();
    assertCan(actor, "maintain", "Maintenance");
    if (!id) return fail(new ValidationError("Missing submission id."));
    await approveNewspaperPrice(id, actor.id);
    revalidatePath("/maintenance/newspaper");
    return ok(null);
  } catch (err) {
    return fail(err);
  }
}

export async function rejectNewspaperPriceAction(
  id: string
): Promise<ActionResult<null>> {
  try {
    const actor = await requireActor();
    assertCan(actor, "maintain", "Maintenance");
    if (!id) return fail(new ValidationError("Missing submission id."));
    await rejectNewspaperPrice(id, actor.id);
    revalidatePath("/maintenance/newspaper");
    return ok(null);
  } catch (err) {
    return fail(err);
  }
}

const publicationInput = z.object({ name: z.string().trim().min(1).max(60) });

export async function createNewspaperPublicationAction(
  input: unknown
): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    assertCan(actor, "maintain", "Maintenance");
    const parsed = publicationInput.safeParse(input);
    if (!parsed.success) {
      return fail(new ValidationError(parsed.error.issues[0]?.message ?? "Invalid input."));
    }
    const created = await createNewspaperPublication(parsed.data.name, actor.id);
    revalidatePath("/maintenance/newspaper");
    return ok(created);
  } catch (err) {
    return fail(err);
  }
}
