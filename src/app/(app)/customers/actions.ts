"use server";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/authz";
import { assertCan } from "@/lib/ability";
import { fail, ok, ValidationError, type ActionResult } from "@/lib/errors";
import { sendMail, isMailConfigured } from "@/lib/mailer";
import { getCustomerDirectoryService } from "@/modules/customers/services/customer-directory-service";
import { getCompanyService } from "@/modules/customers/services/company-service";
import { buildCreditApplicationEmail } from "@/modules/customers/services/credit-application-email";
import { customerUpdateInput, type DuplicateNameMatch } from "@/modules/customers/schemas/customer";
import { addCustomerInput, companyUpdateInput } from "@/modules/customers/schemas/company";
import type { AttachmentKind } from "@/generated/prisma/enums";

const ATTACHMENT_KINDS = ["CREDIT_REQUEST", "BIR_2303", "OTHER"] as const;

export async function uploadCustomerAttachmentAction(
  formData: FormData
): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const file = formData.get("file");
    const kindRaw = String(formData.get("kind") || "OTHER");
    const companyId = formData.get("companyId") ? String(formData.get("companyId")) : undefined;
    const customerId = formData.get("customerId") ? String(formData.get("customerId")) : undefined;
    if (!(file instanceof File) || file.size === 0) {
      return fail(new ValidationError("Choose a file to upload."));
    }
    if (file.size > 10 * 1024 * 1024) {
      return fail(new ValidationError("File is too large (max 10 MB)."));
    }
    if (!companyId && !customerId) return fail(new ValidationError("Missing upload target."));
    const kind = (ATTACHMENT_KINDS.includes(kindRaw as (typeof ATTACHMENT_KINDS)[number])
      ? kindRaw
      : "OTHER") as AttachmentKind;
    const data = new Uint8Array(await file.arrayBuffer());
    const created = await getCompanyService().addAttachment(
      actor,
      { companyId, customerId },
      { kind, fileName: file.name, mimeType: file.type || "application/octet-stream", size: file.size, data }
    );
    revalidatePath(companyId ? `/customers/companies/${companyId}` : `/customers/${customerId}`);
    return ok(created);
  } catch (err) {
    return fail(err);
  }
}

export async function deleteCustomerAttachmentAction(input: {
  id: string;
  companyId?: string;
  customerId?: string;
}): Promise<ActionResult<null>> {
  try {
    const actor = await requireActor();
    if (!input?.id) return fail(new ValidationError("Missing attachment id."));
    await getCompanyService().removeAttachment(actor, input.id);
    revalidatePath(input.companyId ? `/customers/companies/${input.companyId}` : `/customers/${input.customerId}`);
    return ok(null);
  } catch (err) {
    return fail(err);
  }
}

export async function addCustomerAction(
  input: unknown
): Promise<ActionResult<{ customerId: string; companyId: string | null }>> {
  try {
    const actor = await requireActor();
    const parsed = addCustomerInput.safeParse(input);
    if (!parsed.success) {
      return fail(new ValidationError(parsed.error.issues[0]?.message ?? "Invalid input."));
    }
    const result = await getCompanyService().addCustomer(actor, parsed.data);
    revalidatePath("/customers");
    return ok(result);
  } catch (err) {
    return fail(err);
  }
}

/** Non-blocking soft-duplicate check for the create/edit name fields. Returns
 *  existing customers with the same composed "Lastname, Firstname MI." */
export async function checkDuplicateNameAction(input: {
  firstName?: string;
  lastName?: string;
  middleInitial?: string;
  excludeId?: string;
}): Promise<ActionResult<DuplicateNameMatch[]>> {
  try {
    const actor = await requireActor();
    const matches = await getCustomerDirectoryService().checkDuplicateName(actor, {
      firstName: input.firstName ?? "",
      lastName: input.lastName ?? "",
      middleInitial: input.middleInitial,
      excludeId: input.excludeId,
    });
    return ok(matches);
  } catch (err) {
    return fail(err);
  }
}

export async function updateCompanyAction(
  input: unknown
): Promise<ActionResult<null>> {
  try {
    const actor = await requireActor();
    const parsed = companyUpdateInput.safeParse(input);
    if (!parsed.success) {
      return fail(new ValidationError(parsed.error.issues[0]?.message ?? "Invalid input."));
    }
    await getCompanyService().update(actor, parsed.data);
    revalidatePath("/customers");
    revalidatePath(`/customers/companies/${parsed.data.id}`);
    return ok(null);
  } catch (err) {
    return fail(err);
  }
}

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

// ── Credit-line document checklist + Send Credit Application email ───────────

const creditDocsInput = z.object({
  id: z.string().min(1),
  docBusinessReg: z.boolean(),
  docCreditAppForm: z.boolean(),
  docBir2303: z.boolean(),
  docMayorPermit: z.boolean(),
});

export async function updateCreditDocsAction(
  input: unknown
): Promise<ActionResult<null>> {
  try {
    const actor = await requireActor();
    const parsed = creditDocsInput.safeParse(input);
    if (!parsed.success) {
      return fail(new ValidationError(parsed.error.issues[0]?.message ?? "Invalid input."));
    }
    const { id, ...docs } = parsed.data;
    await getCompanyService().updateCreditDocs(actor, id, docs);
    revalidatePath(`/customers/companies/${id}`);
    return ok(null);
  } catch (err) {
    return fail(err);
  }
}

const sendCreditInput = z.object({
  id: z.string().min(1),
  to: z.string().trim().email("Enter a valid email address."),
});

export async function sendCreditApplicationEmailAction(
  input: unknown
): Promise<ActionResult<null>> {
  try {
    const actor = await requireActor();
    assertCan(actor, "update", "Customer");
    const parsed = sendCreditInput.safeParse(input);
    if (!parsed.success) {
      return fail(new ValidationError(parsed.error.issues[0]?.message ?? "Invalid input."));
    }
    if (!isMailConfigured()) {
      return fail(
        new ValidationError(
          "Email isn't set up yet — add SMTP_URL and MAIL_FROM to .env, then restart."
        )
      );
    }
    const company = await getCompanyService().getDetail(actor, parsed.data.id);
    const { subject, body } = buildCreditApplicationEmail(company.name);
    const pdf = await readFile(
      path.join(process.cwd(), "public", "credit-application-form.pdf")
    );
    const sent = await sendMail({
      to: parsed.data.to,
      subject,
      text: body,
      attachments: [
        {
          filename: "Ormoc Printshoppe - Credit Application Form.pdf",
          content: pdf,
          contentType: "application/pdf",
        },
      ],
    });
    if (!sent) {
      return fail(new ValidationError("Email failed to send — check the SMTP settings."));
    }
    return ok(null);
  } catch (err) {
    return fail(err);
  }
}
