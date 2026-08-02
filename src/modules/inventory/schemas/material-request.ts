import { z } from "zod";
import { MrStatus } from "@/generated/prisma/enums";

// ══════════════════════════════════════════════════════════════════════════
// Material Requests — issue stock to a job order. Submit → approve → release.
// Release posts RELEASE ledger rows (qtyOut); on-hand stays derived. Never
// auto-approved. Quantities are PIECES.
// ══════════════════════════════════════════════════════════════════════════

const mrLine = z.object({
  materialId: z.string().min(1),
  qtyNeeded: z.coerce
    .number()
    .int("Quantity must be a whole number.")
    .min(1, "Quantity must be at least 1."),
});

export const mrSubmitInput = z.object({
  jobOrderId: z.string().trim().min(1).optional().nullable(),
  purpose: z.string().trim().max(300).optional(),
  lines: z.array(mrLine).min(1, "Add at least one item to request."),
});
export type MrSubmitInput = z.infer<typeof mrSubmitInput>;

export const mrEditInput = mrSubmitInput.extend({ id: z.string().min(1) });
export type MrEditInput = z.infer<typeof mrEditInput>;

export const mrDecisionInput = z.object({
  id: z.string().min(1),
  note: z.string().trim().max(2000).optional(),
});
export type MrDecisionInput = z.infer<typeof mrDecisionInput>;

// Release: per-line quantity to issue NOW (0 = skip this line this round).
export const mrReleaseInput = z.object({
  id: z.string().min(1),
  note: z.string().trim().min(1, "Release notes are required.").max(2000),
  lines: z
    .array(
      z.object({
        lineId: z.string().min(1),
        qty: z.coerce.number().int().min(0),
      })
    )
    .min(1),
});
export type MrReleaseInput = z.infer<typeof mrReleaseInput>;

export const mrListFilters = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(MrStatus).optional(),
  cursor: z.string().optional(),
  take: z.coerce.number().int().min(1).max(100).default(25),
});
export type MrListFilters = z.infer<typeof mrListFilters>;

// ——— DTOs ———

export type MrLineDto = {
  id: string;
  materialId: string;
  code: string;
  name: string;
  unit: string;
  qtyNeeded: number;
  qtyReleased: number;
  remaining: number; // qtyNeeded − qtyReleased
  onHand: number; // current derived on-hand (for the release desk)
  systemQtyAtRequest: number;
  unitCost: string; // snapshot at request
  lineCost: string; // unitCost × qtyNeeded
};

export type MrListRowDto = {
  id: string;
  number: string;
  status: MrStatus;
  joNumber: string | null;
  purpose: string | null;
  lineCount: number;
  totalQtyNeeded: number;
  costOfMaterials: string;
  requestedByName: string;
  requestedAt: string;
};

export type MrListPageDto = {
  rows: MrListRowDto[];
  nextCursor: string | null;
};

export type MrDetailDto = {
  id: string;
  number: string;
  status: MrStatus;
  jobOrder: { id: string; joNumber: string } | null;
  purpose: string | null;
  requestedByName: string;
  requestedAt: string;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  releasedByName: string | null;
  lastReleasedAt: string | null;
  releaseNote: string | null;
  costOfMaterials: string;
  lines: MrLineDto[];
};

/** A JO that already has one or more MRs — surfaced as a soft duplicate hint. */
export type DuplicateJoHintDto = {
  jobOrderId: string;
  existing: { number: string; status: MrStatus }[];
};
