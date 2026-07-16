import { z } from "zod";
import { AuditEntryStatus, AuditFlagType } from "@/generated/prisma/enums";

// The auditor's sign-off — the legacy verified_by / verified_at, which the
// sheet stamps on every transaction row. An entry targets exactly one document:
// a Sale or a Collection Receipt (enforced by a CHECK constraint in the DB).

export const auditReceiptInput = z
  .object({
    saleId: z.string().min(1).optional(),
    collectionReceiptId: z.string().min(1).optional(),
    status: z.enum(AuditEntryStatus),
    flagType: z.enum(AuditFlagType).optional(),
    remarks: z.string().trim().max(1000).optional(),
  })
  .refine((v) => !!v.saleId !== !!v.collectionReceiptId, {
    message: "An audit entry must target exactly one receipt.",
  })
  .refine((v) => v.status !== AuditEntryStatus.FLAGGED || !!v.flagType, {
    message: "Choose why the receipt is flagged.",
    path: ["flagType"],
  });

export type AuditReceiptInput = z.infer<typeof auditReceiptInput>;
