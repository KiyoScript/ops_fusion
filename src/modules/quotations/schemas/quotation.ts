import { z } from "zod";

// Zod schemas defined once and reused for Server Action validation, form
// validation (RHF resolver), and inferred types. Dates travel as "yyyy-MM-dd"
// strings (native date inputs); services convert to Date. Amounts stay
// strings so the same schema types both the form values and the payload.

const dateString = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date")
  .or(z.literal(""))
  .optional();

const qtyString = z
  .string()
  .trim()
  .regex(/^[1-9]\d*$/, "Qty must be a whole number of at least 1");

// Unlike JO amounts, 0 is allowed: legacy quotes had free lines (waived
// design fee, freebies) that still need to show on the printable.
const moneyString = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, "Enter a valid amount");

// Downpayment fraction 0–1 (legacy Payment Terms tab: 0 / 0.25 / 0.5 / 1).
const rateString = z
  .string()
  .trim()
  .regex(/^(0(\.\d{1,2})?|1(\.0{1,2})?)$/, "Invalid downpayment rate");

export const TAX_TYPES = ["NON_VAT", "VAT_EXCLUSIVE", "VAT_INCLUSIVE"] as const;

export const quotationItemInput = z.object({
  id: z.string().optional(), // present when editing an existing item
  productId: z.string().optional(), // catalog link; empty = custom item
  description: z.string().trim().min(1, "Item description is required").max(500),
  qty: qtyString,
  unitPrice: moneyString,
  discount: moneyString.optional(), // per-line discount amount
  // Product-type specifics (size, material, eyelets…) — written by the
  // per-product calculators, carried opaquely otherwise.
  specs: z.record(z.string(), z.unknown()).optional(),
});

const quotationBaseInput = z.object({
  customerName: z
    .string()
    .trim()
    .min(1, "Customer Name is required.")
    .max(200),
  validUntil: dateString,
  taxType: z.enum(TAX_TYPES),
  paymentTermLabel: z.string().trim().max(120).optional(),
  downpaymentRate: rateString,
  discount: moneyString.optional(), // header-level discount amount
  notes: z.string().trim().max(2000).optional(),
  items: z.array(quotationItemInput).min(1, "At least one line item is required."),
});

export const quotationCreateInput = quotationBaseInput.extend({
  // Set when the quote is drafted from an inquiry (/quotations/new?inquiryId=…)
  // — the service links Inquiry.quotationId in the same transaction.
  inquiryId: z.string().optional(),
});

export const quotationUpdateInput = quotationBaseInput.extend({
  id: z.string().min(1),
});

// One endpoint for every lifecycle step; the service enforces the legal
// from-status and the CASL action per step.
export const quotationTransitionInput = z
  .object({
    id: z.string().min(1),
    action: z.enum(["submit", "approve", "reject", "send"]),
    reason: z.string().trim().max(500).optional(),
  })
  .check((ctx) => {
    if (ctx.value.action === "reject" && !ctx.value.reason?.trim()) {
      ctx.issues.push({
        code: "custom",
        message: "A rejection reason is required.",
        path: ["reason"],
        input: ctx.value,
      });
    }
  });

export const quotationListFilters = z.object({
  q: z.string().trim().max(200).optional(),
  status: z
    .enum([
      "open", // DRAFT + PENDING_APPROVAL + APPROVED + SENT
      "all",
      "DRAFT",
      "PENDING_APPROVAL",
      "APPROVED",
      "SENT",
      "REJECTED",
      "CONVERTED",
    ])
    .default("open"),
  cursor: z.string().optional(),
  take: z.coerce.number().int().min(1).max(100).default(25),
});

export type QuotationItemInput = z.infer<typeof quotationItemInput>;
export type QuotationCreateInput = z.infer<typeof quotationCreateInput>;
export type QuotationUpdateInput = z.infer<typeof quotationUpdateInput>;
export type QuotationTransitionInput = z.infer<typeof quotationTransitionInput>;
export type QuotationListFilters = z.infer<typeof quotationListFilters>;

// ——— DTOs (what leaves the server — never raw Prisma models) ———

export type QuotationItemDto = {
  id: string;
  productId: string | null;
  description: string;
  qty: number;
  unitPrice: string;
  discount: string;
  lineTotal: string;
  specs: Record<string, unknown> | null;
};

export type QuotationTotalsDto = {
  subtotal: string;
  discount: string;
  taxType: string;
  taxAmount: string;
  total: string;
  paymentTermLabel: string | null;
  downpaymentRate: string;
  downpayment: string;
  balance: string;
};

export type QuotationListRowDto = {
  id: string;
  quoteNumber: string;
  customerName: string;
  status: string;
  total: string;
  itemCount: number;
  validUntil: string | null;
  isExpired: boolean;
  createdAt: string;
  createdByName: string;
};

export type QuotationListPageDto = {
  rows: QuotationListRowDto[];
  nextCursor: string | null;
};

export type QuotationDetailDto = {
  id: string;
  quoteNumber: string;
  status: string;
  customer: {
    id: string;
    name: string;
    contactNumber: string | null;
    email: string | null;
    address: string | null;
  };
  validUntil: string | null;
  isExpired: boolean;
  notes: string | null;
  totals: QuotationTotalsDto;
  sentAt: string | null;
  approvedAt: string | null;
  approvedByName: string | null;
  rejectedReason: string | null;
  convertedJoId: string | null;
  convertedJoNumber: string | null;
  createdAt: string;
  createdByName: string;
  items: QuotationItemDto[];
};
