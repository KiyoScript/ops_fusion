import { z } from "zod";
import { MaterialStatus, SupplierStatus } from "@/generated/prisma/enums";

// ══════════════════════════════════════════════════════════════════════════
// Item master (Material) + supplier master. Money/qty discipline:
//   • unitCost = cost per PIECE   (Decimal 12,4 in DB → string in DTOs)
//   • unitPrice = price per BUNDLE (optional)
//   • packSize = pcs per bundle (0 ⇒ by-piece); the ONLY bundle↔pcs bridge
//   • stock quantities are always PIECES
// ══════════════════════════════════════════════════════════════════════════

// ——— Supplier ———

export const supplierInput = z.object({
  code: z.string().trim().max(40).optional(),
  name: z.string().trim().min(1, "Supplier name is required.").max(200),
  contactPerson: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(60).optional(),
  email: z.string().trim().max(200).optional(),
  address: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(2000).optional(),
  status: z.enum(SupplierStatus).default(SupplierStatus.ACTIVE),
});

export type SupplierInput = z.infer<typeof supplierInput>;

export const supplierListFilters = z.object({
  q: z.string().trim().max(200).optional(),
  includeInactive: z.coerce.boolean().default(false),
});
export type SupplierListFilters = z.infer<typeof supplierListFilters>;

export type SupplierDto = {
  id: string;
  code: string | null;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  status: SupplierStatus;
  materialCount: number;
  createdAt: string;
};

// ——— Material ———

// Item code carries a PREFIX + running number, e.g. "PAP-001". Free-form as
// entered, unique-validated. Letters/numbers/dashes only.
const itemCode = z
  .string()
  .trim()
  .min(1, "Item code is required.")
  .max(40)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9-]*$/,
    "Use letters, numbers and dashes (e.g. PAP-001)."
  );

export const materialInput = z.object({
  code: itemCode,
  name: z.string().trim().min(1, "Item name is required.").max(200),
  category: z.string().trim().max(80).optional(),
  location: z.string().trim().max(120).optional(),
  area: z.string().trim().max(120).optional(),
  unit: z.string().trim().min(1).max(20).default("pc"),
  packSize: z.coerce.number().int().min(0, "Pack size can't be negative.").default(0),
  unitCost: z.coerce.number().min(0, "Cost can't be negative."), // per pc
  unitPrice: z.coerce.number().min(0).optional(), // per bundle
  reorderLevel: z.coerce.number().int().min(0).default(0),
  supplierId: z.string().trim().min(1).optional().nullable(),
  status: z.enum(MaterialStatus).default(MaterialStatus.ACTIVE),
  possibleOffcut: z.coerce.boolean().default(false),
  notes: z.string().trim().max(2000).optional(),
  // Opening stock (pcs) — honored on CREATE only; posts an OPENING ledger row.
  // Ignored on update (correct stock via an adjustment or cycle count instead).
  openingQty: z.coerce.number().int().min(0).default(0),
});
export type MaterialInput = z.infer<typeof materialInput>;

export const materialUpdateInput = materialInput.extend({
  id: z.string().min(1),
});
export type MaterialUpdateInput = z.infer<typeof materialUpdateInput>;

export const materialListFilters = z.object({
  q: z.string().trim().max(200).optional(),
  category: z.string().trim().max(80).optional(),
  status: z.enum(MaterialStatus).optional(),
  cursor: z.string().optional(),
  take: z.coerce.number().int().min(1).max(200).default(50),
});
export type MaterialListFilters = z.infer<typeof materialListFilters>;

export type MaterialDto = {
  id: string;
  code: string;
  name: string;
  category: string | null;
  location: string | null;
  area: string | null;
  unit: string;
  packSize: number;
  unitCost: string; // per pc
  unitPrice: string | null; // per bundle
  reorderLevel: number;
  status: MaterialStatus;
  possibleOffcut: boolean;
  supplier: { id: string; name: string } | null;
  onHand: number; // derived from the ledger, in pcs
  stockValue: string; // onHand × unitCost
  belowReorder: boolean; // reorderLevel > 0 && onHand < reorderLevel
  notes: string | null;
  createdAt: string;
};

export type MaterialListPageDto = {
  rows: MaterialDto[];
  nextCursor: string | null;
};

/** One stock movement (ledger row) with the running on-hand after it. */
export type LedgerMovementDto = {
  id: string;
  type: string; // LedgerType
  qtyIn: number;
  qtyOut: number;
  unitCost: string;
  totalValue: string;
  balance: number; // running on-hand (pcs) after this movement
  refType: string | null;
  refId: string | null;
  note: string | null;
  occurredAt: string;
  createdByName: string;
};

export type MaterialDetailDto = MaterialDto & {
  movements: LedgerMovementDto[];
};

/** A material whose derived on-hand has fallen below its reorder level. */
export type ReorderRowDto = {
  id: string;
  code: string;
  name: string;
  category: string | null;
  supplierName: string | null;
  onHand: number;
  reorderLevel: number;
  shortBy: number; // reorderLevel − onHand (pcs)
  unit: string;
  packSize: number;
};

/** Options for the create/edit item form — existing code prefixes (so the same
 *  grouping is reused, not re-invented) and the active supplier list. */
export type MaterialFormOptionsDto = {
  prefixes: string[];
  suppliers: { id: string; name: string }[];
};
