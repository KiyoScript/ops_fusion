import { z } from "zod";
import { PaymentMethod } from "@/generated/prisma/enums";

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
  COLLECTION: "COLLECTION",
} as const;

export type ReceiptKind = (typeof RECEIPT_KIND)[keyof typeof RECEIPT_KIND];

export const RECEIPT_KIND_LABEL: Record<ReceiptKind, string> = {
  JO_RECEIPT: "Job Order Receipt",
  SI_VAT: "Sales Invoice — VAT",
  SI_NON_VAT: "Sales Invoice — Non-VAT",
  COLLECTION: "Collection Receipt",
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

export const receivePaymentInput = z.object({
  jobOrderId: z.string().min(1, "Job order is required."),
  kind: z.enum(RECEIPT_KIND),
  /** Amount of the document — what the customer owes on this receipt. */
  amount: money,
  /** Cash handed over. Blank for cheque / transfer, where no change is given. */
  cashTendered: optionalMoney,
  method: z.enum(PaymentMethod).default(PaymentMethod.CASH),
  /** Cheque no. / GCash reference. */
  methodDetail: z.string().trim().max(120).optional(),
  receivedAt: z.string().optional(), // ISO date; defaults to now
  notes: z.string().trim().max(2000).optional(),
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

export type ReceivePaymentInput = z.infer<typeof receivePaymentInput>;
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
  amountPaid: string;
  cashTendered: string | null;
  changeGiven: string;
  method: PaymentMethod | null;
  methodDetail: string | null;
  receivedAt: string;
  createdByName: string;
  /** Auditor sign-off, once reviewed. */
  auditStatus: "REVIEWED" | "FLAGGED" | null;
  auditorName: string | null;
  auditRemarks: string | null;
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
  joReceipts: { count: number; gross: string };
  /** Cash collected against invoices — NOT revenue, shown separately. */
  collections: { count: number; gross: string };
  grossSales: string;
  pendingAudit: number;
};
