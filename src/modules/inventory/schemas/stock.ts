import { z } from "zod";
import { AdjStatus, CountStatus } from "@/generated/prisma/enums";

// ══════════════════════════════════════════════════════════════════════════
// Stock operations — manual adjustments and cycle counts. Both post to the
// append-only ledger only AFTER an explicit approval (never on creation).
// All quantities are PIECES.
// ══════════════════════════════════════════════════════════════════════════

// ——— Stock adjustment ———

export const adjustmentInput = z.object({
  reason: z.string().trim().min(1, "A reason is required.").max(300),
  note: z.string().trim().max(2000).optional(),
  lines: z
    .array(
      z.object({
        materialId: z.string().min(1),
        // signed pcs: positive adds stock, negative removes it. Non-zero.
        qtyDelta: z.coerce
          .number()
          .int("Quantity must be a whole number.")
          .refine((n) => n !== 0, "Quantity can't be zero."),
        // per-pc cost for valuing the movement; blank → the item's unit cost.
        unitCost: z.coerce.number().min(0).optional(),
        reason: z.string().trim().max(300).optional(),
      })
    )
    .min(1, "Add at least one item to adjust."),
});
export type AdjustmentInput = z.infer<typeof adjustmentInput>;

export const adjustmentDecisionInput = z.object({
  id: z.string().min(1),
  note: z.string().trim().max(2000).optional(), // decision remark
});
export type AdjustmentDecisionInput = z.infer<typeof adjustmentDecisionInput>;

export const adjustmentListFilters = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(AdjStatus).optional(),
  cursor: z.string().optional(),
  take: z.coerce.number().int().min(1).max(100).default(25),
});
export type AdjustmentListFilters = z.infer<typeof adjustmentListFilters>;

export type AdjustmentLineDto = {
  id: string;
  materialId: string;
  code: string;
  name: string;
  unit: string;
  qtyDelta: number;
  unitCost: string;
  lineValue: string; // qtyDelta × unitCost (signed)
  reason: string | null;
};

export type AdjustmentListRowDto = {
  id: string;
  number: string;
  reason: string;
  status: AdjStatus;
  lineCount: number;
  netQty: number; // Σ qtyDelta
  requestedByName: string;
  requestedAt: string;
  decidedByName: string | null;
  decidedAt: string | null;
};

export type AdjustmentListPageDto = {
  rows: AdjustmentListRowDto[];
  nextCursor: string | null;
};

export type AdjustmentDetailDto = AdjustmentListRowDto & {
  note: string | null;
  decisionNote: string | null;
  lines: AdjustmentLineDto[];
};

// ——— Cycle count ———

export const cycleCountInput = z.object({
  location: z.string().trim().max(120).optional(),
  note: z.string().trim().max(2000).optional(),
  lines: z
    .array(
      z.object({
        materialId: z.string().min(1),
        countedQty: z.coerce
          .number()
          .int("Counted quantity must be a whole number.")
          .min(0, "Counted quantity can't be negative."),
      })
    )
    .min(1, "Add at least one item to count."),
});
export type CycleCountInput = z.infer<typeof cycleCountInput>;

export const cycleCountUpdateInput = cycleCountInput.extend({
  id: z.string().min(1),
});
export type CycleCountUpdateInput = z.infer<typeof cycleCountUpdateInput>;

export const cycleCountDecisionInput = z.object({
  id: z.string().min(1),
  note: z.string().trim().max(2000).optional(),
});
export type CycleCountDecisionInput = z.infer<typeof cycleCountDecisionInput>;

export const cycleCountListFilters = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(CountStatus).optional(),
  cursor: z.string().optional(),
  take: z.coerce.number().int().min(1).max(100).default(25),
});
export type CycleCountListFilters = z.infer<typeof cycleCountListFilters>;

export type CycleCountLineDto = {
  id: string;
  materialId: string;
  code: string;
  name: string;
  unit: string;
  systemQty: number; // snapshot at count time
  countedQty: number;
  variance: number; // countedQty − systemQty
  unitCost: string;
  varianceValue: string; // variance × unitCost (signed)
};

export type CycleCountListRowDto = {
  id: string;
  number: string;
  status: CountStatus;
  location: string | null;
  lineCount: number;
  netVariance: number; // Σ (countedQty − systemQty)
  countedByName: string;
  countedAt: string;
  approvedByName: string | null;
  approvedAt: string | null;
};

export type CycleCountListPageDto = {
  rows: CycleCountListRowDto[];
  nextCursor: string | null;
};

export type CycleCountDetailDto = CycleCountListRowDto & {
  note: string | null;
  lines: CycleCountLineDto[];
};
