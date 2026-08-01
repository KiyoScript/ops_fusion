import { z } from "zod";
import {
  PaymentMethod,
  PaymentStatus,
  ReceiptVoidType,
} from "@/generated/prisma/enums";

// ══════════════════════════════════════════════════════════════════════════
// RECEIVE PAYMENT — one action on a Job Order, four kinds of receipt.
//
// JO_RECEIPT / SI_VAT / SI_NON_VAT are recorded as a Sale (they book revenue);
// COLLECTION lands in CollectionReceipt (it only collects cash against revenue
// already booked). Keeping them apart is what stops the VAT reports
// double-counting — see prisma/schema/sale.prisma.
// ══════════════════════════════════════════════════════════════════════════

export const RECEIPT_KIND = {
  JO_RECEIPT: "JO_RECEIPT",
  SI_VAT: "SI_VAT",
  SI_NON_VAT: "SI_NON_VAT",
  SI_CHARGE: "SI_CHARGE",
  COLLECTION: "COLLECTION",
} as const;

export type ReceiptKind = (typeof RECEIPT_KIND)[keyof typeof RECEIPT_KIND];

export const RECEIPT_KIND_LABEL: Record<ReceiptKind, string> = {
  JO_RECEIPT: "Job Order Receipt",
  SI_VAT: "Sales Invoice — VAT",
  SI_NON_VAT: "Sales Invoice — Non-VAT",
  SI_CHARGE: "Sales Invoice — Charge Invoice",
  COLLECTION: "Collection Receipt",
};

/** When to reach for each one — docs/sales.txt §2, shown on the tiles. */
export const RECEIPT_KIND_HINT: Record<ReceiptKind, string> = {
  JO_RECEIPT: "Walk-in who doesn't ask for an invoice",
  SI_VAT: "Sale completed · VAT-registered customer",
  SI_NON_VAT: "Sale completed · non-VAT customer",
  SI_CHARGE: "Sale on credit (utang) · settled later by a Collection Receipt",
  COLLECTION: "Customer paying down a Charge Invoice",
};

/** Money as typed at the counter: "1,234.50" — commas tolerated, blank isn't. */
const money = z
  .string()
  .trim()
  .min(1, "Enter an amount.")
  .regex(/^\d{1,3}(,\d{3})*(\.\d{1,2})?$|^\d+(\.\d{1,2})?$/, "Enter a valid amount.");

const optionalMoney = z
  .string()
  .trim()
  .regex(/^\d{1,3}(,\d{3})*(\.\d{1,2})?$|^\d+(\.\d{1,2})?$/, "Enter a valid amount.")
  .optional()
  .or(z.literal(""));

/**
 * One tender line of a split payment: ₱1,000 cash + ₱1,200 GCash on a single
 * invoice is two lines. `amount` is what this method APPLIES to the document —
 * cash over-tender belongs on `cashTendered`, not here.
 */
export const paymentLineInput = z.object({
  method: z.enum(PaymentMethod),
  amount: money,
  /** Cheque no. / GCash reference for this line. */
  reference: z.string().trim().max(120).optional(),
});

export const receivePaymentInput = z.object({
  jobOrderId: z.string().min(1, "Job order is required."),
  kind: z.enum(RECEIPT_KIND),
  /** Amount of the document — what the customer owes on this receipt. */
  amount: money,
  /** @deprecated The cash payment line carries this now. Ignored. */
  cashTendered: optionalMoney,
  /**
   * What the customer handed over, one line per method. An EMPTY array is
   * legal and means nothing was received — a sale wholly on credit. Omit the
   * field entirely and `method` / `methodDetail` below are used instead, so
   * single-payment callers keep working unchanged.
   */
  payments: z.array(paymentLineInput).max(10, "At most 10 payment lines.").optional(),
  method: z.enum(PaymentMethod).default(PaymentMethod.CASH),
  /** Cheque no. / GCash reference. */
  methodDetail: z.string().trim().max(120).optional(),
  receivedAt: z.string().optional(), // ISO date; defaults to now
  notes: z.string().trim().max(2000).optional(),
});

// ══════════════════════════════════════════════════════════════════════════
// CANCEL / VOID / REPLACE — docs/sales.txt §5.
//
// The receipt keeps its serial number and stays in the booklet; it simply
// stops counting as revenue, which reopens the Job Order's balance so the
// counter can issue a fresh one. A REPLACED receipt is voided and reissued in
// the same breath, and the two point at each other.
// ══════════════════════════════════════════════════════════════════════════

export const VOID_TYPE_LABEL: Record<ReceiptVoidType, string> = {
  CANCELLED: "Cancelled",
  VOID: "Void",
  REPLACED: "Replaced",
};

/** Why each mark is used — shown to whoever is signing the cancellation off. */
export const VOID_TYPE_HINT: Record<ReceiptVoidType, string> = {
  CANCELLED: "The transaction did not push through.",
  VOID: "The receipt itself was spoiled — wrong amount, misprint, torn.",
  REPLACED: "Reissued under a new serial number, linked to this one.",
};

export const voidReceiptInput = z.object({
  receiptId: z.string().min(1, "Receipt is required."),
  kind: z.enum(RECEIPT_KIND),
  /** REPLACED is not accepted here — use `replaceReceipt`, which reissues. */
  type: z.enum([ReceiptVoidType.CANCELLED, ReceiptVoidType.VOID]),
  // §5.1 step 2: the reason is written on the face of the receipt, so it is
  // never optional.
  reason: z.string().trim().min(3, "Write the reason for the cancellation.").max(500),
});

/** Void a receipt and issue its replacement in one transaction. */
export const replaceReceiptInput = z.object({
  receiptId: z.string().min(1, "Receipt is required."),
  kind: z.enum(RECEIPT_KIND),
  reason: z.string().trim().min(3, "Write the reason for the replacement.").max(500),
  /** The corrected receipt. Same shape as a fresh Receive Payment. */
  replacement: receivePaymentInput,
});

export const receiptListFilters = z.object({
  q: z.string().trim().max(200).optional(),
  /** Day view — the legacy daily sales log. Defaults to today. */
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD.")
    .optional(),
  cursor: z.string().optional(),
  take: z.coerce.number().int().min(1).max(100).default(50),
});

export type PaymentLineInput = z.infer<typeof paymentLineInput>;
export type ReceivePaymentInput = z.infer<typeof receivePaymentInput>;
export type VoidReceiptInput = z.infer<typeof voidReceiptInput>;
export type ReplaceReceiptInput = z.infer<typeof replaceReceiptInput>;
export type ReceiptListFilters = z.infer<typeof receiptListFilters>;

// ——— DTOs ———

/** What the Receive Payment dialog needs to open: the JO, pre-filled. */
export type ReceivePaymentOptionsDto = {
  jobOrderId: string;
  joNumber: string;
  customer: {
    id: string;
    name: string;
    address: string | null;
    tin: string | null;
    vatRegistered: boolean;
  };
  /** JO total, and what's already been received against it. */
  joTotal: string;
  totalReceived: string;
  balance: string;
  /** Next number per receipt kind — null when no ACTIVE booklet exists. */
  nextNumbers: Record<ReceiptKind, string | null>;
  /** Receipts already issued against this JO. */
  issued: ReceiptRowDto[];
};

/** A tender line as stored — the full truth behind a split payment. */
export type PaymentLineDto = {
  method: PaymentMethod;
  amount: string;
  reference: string | null;
};

export type ReceiptRowDto = {
  id: string;
  kind: ReceiptKind;
  kindLabel: string;
  documentNo: string;
  customerName: string;
  joNumber: string | null;
  /** Gross, VAT-inclusive. */
  amount: string;
  vatableSales: string;
  vatAmount: string;
  /** What was actually received and applied to this document. */
  amountPaid: string;
  /** Left unsettled — credit / utang / Accounts Receivable. "0.00" if paid. */
  balanceDue: string;
  paymentStatus: PaymentStatus;
  cashTendered: string | null;
  changeGiven: string;
  /** Dominant (largest) tender — the header summary. See `payments` for all. */
  method: PaymentMethod | null;
  methodDetail: string | null;
  /** Every tender line, in entry order. One line = a normal single payment. */
  payments: PaymentLineDto[];
  receivedAt: string;
  createdByName: string;
  /** Auditor sign-off, once reviewed. */
  auditStatus: "REVIEWED" | "FLAGGED" | null;
  auditorName: string | null;
  auditRemarks: string | null;
  /** Cancelled / Void / Replaced — null while the receipt is still good. */
  voidType: ReceiptVoidType | null;
  voidReason: string | null;
  voidedAt: string | null;
  voidedByName: string | null;
  /** REPLACED: the serial issued in its place, and the one it superseded. */
  replacedByDocumentNo: string | null;
  replacesDocumentNo: string | null;
};

export type ReceiptListPageDto = {
  rows: ReceiptRowDto[];
  nextCursor: string | null;
};

/** The day's totals — the legacy EOD / BIR summary, split VAT vs Non-VAT. */
export type DailySalesSummaryDto = {
  date: string;
  /** Revenue documents only — Collection Receipts are excluded by design. */
  vat: { count: number; gross: string; vatableSales: string; vatAmount: string };
  nonVat: { count: number; gross: string };
  /** Credit sales — revenue at point of sale, money not in yet. */
  charge: { count: number; gross: string; vatableSales: string; vatAmount: string };
  joReceipts: { count: number; gross: string };
  /** Cash collected against invoices — NOT revenue, shown separately. */
  collections: { count: number; gross: string };
  grossSales: string;
  /** Unsettled across every receipt issued today: what is owed to us. */
  receivables: { count: number; amount: string };
  pendingAudit: number;
};
