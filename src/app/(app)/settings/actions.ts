"use server";

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/lib/authz";
import { defineAbilityFor } from "@/lib/ability";
import { fail, ok, ValidationError, type ActionResult } from "@/lib/errors";
import { getModuleFlagService } from "@/modules/shared/services/module-flag-service";
import { setContactInfo, setOwnerName } from "@/lib/company-profile";
import { getCreditTermService } from "@/modules/customers/services/credit-term-service";

// The proprietor's signature is a single shared asset that every printable
// (JO / DR / Quotation) already reads from public/jon-signature.png — so
// "configuring" it is just replacing that file. No DB row, no per-PDF wiring.
const SIGNATURE_PATH = join(process.cwd(), "public", "jon-signature.png");
const MAX_SIGNATURE_BYTES = 2_000_000;

/** Replaces the proprietor signature used across all printed documents. */
export async function uploadSignatureAction(
  formData: FormData
): Promise<ActionResult<null>> {
  try {
    const actor = await requireActor();
    // Same admin gate as the Settings page itself.
    if (defineAbilityFor(actor).cannot("update", "ModuleFlag")) {
      return fail(new ValidationError("You are not allowed to change settings."));
    }
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return fail(new ValidationError("Choose a signature image to upload."));
    }
    if (file.type !== "image/png" && file.type !== "image/jpeg") {
      return fail(new ValidationError("Signature must be a PNG or JPEG image."));
    }
    if (file.size > MAX_SIGNATURE_BYTES) {
      return fail(new ValidationError("Signature image must be under 2 MB."));
    }
    await writeFile(SIGNATURE_PATH, Buffer.from(await file.arrayBuffer()));
    return ok(null);
  } catch (err) {
    return fail(err);
  }
}

const ownerNameInput = z.object({
  ownerName: z.string().trim().min(1, "Owner name is required.").max(120),
});

/** Sets the proprietor name printed on all documents. */
export async function saveOwnerNameAction(
  raw: unknown
): Promise<ActionResult<null>> {
  try {
    const actor = await requireActor();
    if (defineAbilityFor(actor).cannot("update", "ModuleFlag")) {
      return fail(new ValidationError("You are not allowed to change settings."));
    }
    const parsed = ownerNameInput.safeParse(raw);
    if (!parsed.success) {
      return fail(new ValidationError(parsed.error.issues[0]?.message ?? "Invalid input."));
    }
    await setOwnerName(parsed.data.ownerName);
    return ok(null);
  } catch (err) {
    return fail(err);
  }
}

const contactInfoInput = z.object({
  contactPerson: z.string().trim().min(1, "Contact person is required.").max(120),
  contactPhone: z.string().trim().min(1, "Contact phone is required.").max(60),
  contactEmail: z.string().trim().min(1, "Contact email is required.").max(120),
});

/** Sets the footer contact line printed on all printables. */
export async function saveContactInfoAction(
  raw: unknown
): Promise<ActionResult<null>> {
  try {
    const actor = await requireActor();
    if (defineAbilityFor(actor).cannot("update", "ModuleFlag")) {
      return fail(new ValidationError("You are not allowed to change settings."));
    }
    const parsed = contactInfoInput.safeParse(raw);
    if (!parsed.success) {
      return fail(new ValidationError(parsed.error.issues[0]?.message ?? "Invalid input."));
    }
    await setContactInfo(parsed.data);
    return ok(null);
  } catch (err) {
    return fail(err);
  }
}

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

// ─── Credit terms (moved here from Customer Maintenance) ─────────────────────
// The reference list of available credit terms (30 / 60 / 90 days). Auth lives
// in the service (assertCan maintain Maintenance).
const CREDIT_TERMS_PAGE = "/settings";

export async function createCreditTermAction(
  days: unknown
): Promise<ActionResult<null>> {
  try {
    const actor = await requireActor();
    const n = Number(days);
    if (!Number.isFinite(n)) return fail(new ValidationError("Enter a number of days."));
    await getCreditTermService().create(actor, Math.trunc(n));
    revalidatePath(CREDIT_TERMS_PAGE);
    return ok(null);
  } catch (err) {
    return fail(err);
  }
}

export async function toggleCreditTermAction(data: {
  id: string;
  isActive: boolean;
}): Promise<ActionResult<null>> {
  try {
    const actor = await requireActor();
    if (!data?.id) return fail(new ValidationError("Missing id."));
    await getCreditTermService().setActive(actor, data.id, data.isActive);
    revalidatePath(CREDIT_TERMS_PAGE);
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
    revalidatePath(CREDIT_TERMS_PAGE);
    return ok(null);
  } catch (err) {
    return fail(err);
  }
}
