import { z } from "zod";
import { BookletStatus, BookletType } from "@/generated/prisma/enums";

// ══════════════════════════════════════════════════════════════════════════
// BOOKLETS — the physical BIR receipt booklets and the numbers they issue.
// Ported from the legacy Doc_Series sheet (DocSeriesService.js).
//
// Range size is set PER BOOKLET (the legacy sheet hard-coded blocks of 50).
// The service suggests the next block after the last range of that type; the
// admin is free to size a 25-, 50- or 100-leaf booklet.
// ══════════════════════════════════════════════════════════════════════════

/** The prefix each document type prints on its number: IN-0578, JO-0042… */
export const BOOKLET_PREFIX: Record<BookletType, string> = {
  [BookletType.SI_VAT]: "IN",
  [BookletType.SI_NON_VAT]: "IN",
  [BookletType.JO_SLIP]: "JO",
  [BookletType.CR]: "CR",
  [BookletType.DR]: "DR",
};

export const BOOKLET_TYPE_LABEL: Record<BookletType, string> = {
  [BookletType.SI_VAT]: "Sales Invoice — VAT",
  [BookletType.SI_NON_VAT]: "Sales Invoice — Non-VAT",
  [BookletType.JO_SLIP]: "Job Order Receipt",
  [BookletType.CR]: "Collection Receipt",
  [BookletType.DR]: "Delivery Receipt",
};

export const createBookletInput = z.object({
  type: z.enum(BookletType),
  seriesStart: z.coerce.number().int().min(1, "Series start must be at least 1."),
  seriesEnd: z.coerce.number().int().min(1),
  label: z.string().trim().max(120).optional(),
  gapExempt: z.boolean().default(false),
});

export const bookletIdInput = z.object({ id: z.string().min(1) });

export const rejectBookletInput = z.object({
  id: z.string().min(1),
  note: z.string().trim().max(500).optional(),
});

export const bookletListFilters = z.object({
  type: z.enum(BookletType).optional(),
  status: z.enum(BookletStatus).optional(),
});

export type CreateBookletInput = z.infer<typeof createBookletInput>;
export type RejectBookletInput = z.infer<typeof rejectBookletInput>;
export type BookletListFilters = z.infer<typeof bookletListFilters>;

// ——— DTOs ———

export type BookletDto = {
  id: string;
  type: BookletType;
  typeLabel: string;
  prefix: string;
  label: string | null;
  seriesStart: number;
  seriesEnd: number;
  nextNumber: number;
  status: BookletStatus;
  gapExempt: boolean;
  rejectionNote: string | null;
  /** Numbers left in the booklet. 0 → exhausted. */
  remaining: number;
  /** Numbers already issued. */
  used: number;
  capacity: number;
  /** The number the NEXT receipt off this booklet will carry, e.g. "IN-0578". */
  nextDocumentNo: string | null;
  openedByName: string;
  approvedByName: string | null;
  createdAt: string;
};

/** What the "new booklet" form pre-fills: the block after the last one. */
export type BookletSuggestionDto = {
  type: BookletType;
  prefix: string;
  suggestedStart: number;
  suggestedEnd: number;
};
