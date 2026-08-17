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

/** Which invoice a collection pays down, and by how much. */
export const allocationInput = z.object({
  saleId: z.string().min(1),
  amount: money,
});

export const receivePaymentInput = z.object({
  jobOrderId: z.string().min(1, "Job order is required."),
  kind: z.enum(RECEIPT_KIND),
  /**
   * The FACE VALUE of the document being issued — not the job order's total.
   *
   * On an invoice this is what the cashier chooses to bill now, capped at the
   * job's unbilled remainder: a ₱500 downpayment on a ₱1,344 job issues an
   * invoice for ₱500, and the ₱844 is invoiced later by a second one. On a
   * Charge Invoice it is the amount put on credit; on a collection, the amount
   * being collected.
   */
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

  /**
   * COLLECTION only — whether to print a numbered Collection Receipt.
   *
   * False means the money is still recorded and the receivable still closes,
   * but no booklet number is consumed. The CR is a *supplementary* document
   * (docs/sales.txt §6): the customer may simply not want one.
   *
   * Optional rather than defaulted so callers building the input by hand are
   * not forced to spell out the common case; the service reads it as true
   * unless explicitly false.
   */
  issueDocument: z.boolean().optional(),

  /**
   * COLLECTION only — which invoices the money pays down. Omit and the service
   * applies it oldest-invoice-first, which is what the counter does by hand.
   */
  allocations: z.array(allocationInput).max(50).optional(),
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

/** Whether a receipt kind may be issued right now, and why not if it can't. */
export type ReceiptAvailabilityDto = {
  enabled: boolean;
  /** Shown on the disabled tile — never leave the cashier guessing. */
  reason: string | null;
};

/** An invoice with money still owed on it — what a collection pays down. */
export type OpenInvoiceDto = {
  id: string;
  documentNo: string;
  kindLabel: string;
  saleDate: string;
  dueDate: string | null;
  /** Face value of the invoice. */
  amount: string;
  /** Still owed: amount − amountPaid − settledAmount. */
  openBalance: string;
  /** Days past due — 0 while current, null when the invoice has no terms. */
  daysOverdue: number | null;
};

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
  joTotal: string;
  /** Money actually in against this JO — invoices paid at the counter plus
   *  every collection since. */
  totalReceived: string;
  /**
   * The two numbers that drive everything. They are NOT the same thing, and
   * conflating them is what let a fully-invoiced job be invoiced again:
   *
   *   unbilled    — job total less every live receipt's face value. Governs
   *                 whether another INVOICE may be issued.
   *   outstanding — billed but not yet collected (A/R). Governs whether a
   *                 COLLECTION may be issued.
   *
   * A ₱1,344 job carrying one charge invoice has unbilled ₱0 and outstanding
   * ₱1,344: nothing left to invoice, everything left to collect.
   */
  unbilled: string;
  outstanding: string;
  /** Per kind: may it be issued, and if not, why not. */
  availability: Record<ReceiptKind, ReceiptAvailabilityDto>;
  /** The kind the counter should reach for, given the state. Preselected. */
  recommended: ReceiptKind | null;
  /** Open invoices on this JO, oldest first — what a collection settles. */
  openInvoices: OpenInvoiceDto[];
  /** Credit terms & limit. `enabled` mirrors the credit-control module flag. */
  credit: {
    enabled: boolean;
    termDays: number | null;
    limit: string | null;
    /** This customer's open A/R across ALL their job orders. */
    customerOutstanding: string;
    /** limit − customerOutstanding; null when no limit is set. */
    available: string | null;
  };
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
  /** Null only on an undocumented collection — money in, no CR printed. */
  documentNo: string | null;
  /** False only on an undocumented collection. Always true for a Sale. */
  documentIssued: boolean;
  customerName: string;
  joNumber: string | null;
  /** Gross, VAT-inclusive. */
  amount: string;
  vatableSales: string;
  vatAmount: string;
  /** What was actually received and applied to this document AT ISSUE. */
  amountPaid: string;
  /** Collected against it SINCE issue, via collection receipts. */
  settledAmount: string;
  /** Left unsettled — credit / utang / A/R. "0.00" once fully collected. */
  balanceDue: string;
  /** SI_CHARGE only: when it falls due under the customer's terms. */
  dueDate: string | null;
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

// ══════════════════════════════════════════════════════════════════════════
// ACCOUNTS RECEIVABLE — who owes us what, and how long it has been owed.
//
// Aging runs off Sale.dueDate, frozen at issue from the customer's terms. An
// invoice with no terms has no due date and can never be overdue; it sits in
// the CURRENT bucket until someone agrees terms with that customer.
// ══════════════════════════════════════════════════════════════════════════

export const AGING_BUCKETS = ["CURRENT", "D1_30", "D31_60", "D61_90", "D90_PLUS"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export const AGING_BUCKET_LABEL: Record<AgingBucket, string> = {
  CURRENT: "Current",
  D1_30: "1–30 days",
  D31_60: "31–60 days",
  D61_90: "61–90 days",
  D90_PLUS: "90+ days",
};

/** Where an invoice falls, by days past its due date. */
export function bucketFor(daysOverdue: number | null): AgingBucket {
  if (daysOverdue === null || daysOverdue <= 0) return "CURRENT";
  if (daysOverdue <= 30) return "D1_30";
  if (daysOverdue <= 60) return "D31_60";
  if (daysOverdue <= 90) return "D61_90";
  return "D90_PLUS";
}

/** One customer's line on the A/R ledger. */
export type ReceivableCustomerDto = {
  customerId: string;
  customerName: string;
  invoiceCount: number;
  /** Total still owed across every open invoice. */
  outstanding: string;
  /** The oldest open invoice's age in days past due; null if none are due. */
  oldestDaysOverdue: number | null;
  /** Outstanding split by age. */
  aging: Record<AgingBucket, string>;
  creditTermDays: number | null;
  creditLimit: string | null;
  /** limit − exposure; null when no limit is set. Negative = over limit. */
  creditAvailable: string | null;
  overLimit: boolean;
  /** Set when this customer is a company contact — the billed entity. */
  companyId: string | null;
  companyName: string | null;
  /**
   * What the credit limit is measured against.
   *
   * Equal to `outstanding` for an individual. For a company contact it is the
   * COMPANY's whole open A/R, because the ceiling was agreed with the company
   * and merely copied onto each contact — judging each contact against it
   * separately would grant it once per contact (docs/sales-contract.md R15).
   * This is the number that explains an over-limit flag on a contact whose own
   * invoices are small.
   */
  exposure: string;
  /**
   * Money the shop is HOLDING for this customer from an overpayment — the
   * opposite sign to `outstanding`, and deliberately not netted against it.
   * A customer can appear here owing nothing and still hold credit.
   */
  creditOnAccount: string;
};

export type ReceivablesSummaryDto = {
  totalOutstanding: string;
  customerCount: number;
  invoiceCount: number;
  aging: Record<AgingBucket, string>;
  /** Customers whose open A/R exceeds their credit limit. */
  overLimitCount: number;
  /** Total unspent customer credit the shop is holding. */
  totalCreditOnAccount: string;
};

export type ReceivablesPageDto = {
  summary: ReceivablesSummaryDto;
  customers: ReceivableCustomerDto[];
  /** Mirrors the credit-control module flag — hides limit columns when off. */
  creditControlEnabled: boolean;
};

/** A customer's Statement of Account: every open invoice, oldest first. */
export type StatementOfAccountDto = {
  customerId: string;
  customerName: string;
  customerAddress: string | null;
  customerTin: string | null;
  asOf: string;
  invoices: (OpenInvoiceDto & {
    joNumber: string | null;
    bucket: AgingBucket;
  })[];
  totalOutstanding: string;
  aging: Record<AgingBucket, string>;
  creditTermDays: number | null;
  creditLimit: string | null;
};

// ══════════════════════════════════════════════════════════════════════════
// CUSTOMER-LEVEL COLLECTION — the QuickBooks "Receive Payment" shape.
//
// A customer pays down their ACCOUNT, not one job order: one payment settles
// as many invoices as it reaches, across whatever job orders they belong to,
// applied oldest-first unless the cashier says otherwise. Money over and above
// what is owed is held as customer credit rather than refused or handed back.
// ══════════════════════════════════════════════════════════════════════════

export const collectFromCustomerInput = z.object({
  customerId: z.string().min(1, "Customer is required."),
  /**
   * What the customer handed over now. Split across `payments` when they pay
   * two ways. May be zero when the payment is funded entirely by credit.
   */
  payments: z.array(paymentLineInput).max(10, "At most 10 payment lines.").optional(),
  /** Credit on file to spend on this payment. Drawn oldest-credit-first. */
  creditApplied: optionalMoney,
  /**
   * Which invoices this settles, and for how much. Omit and the money is
   * applied oldest-invoice-first, which is what the counter does by hand.
   */
  allocations: z.array(allocationInput).max(50).optional(),
  /** Print a numbered Collection Receipt? See receivePaymentInput. */
  issueDocument: z.boolean().optional(),
  receivedAt: z.string().optional(),
  notes: z.string().trim().max(2000).optional(),

  /**
   * Reissue a spoiled Collection Receipt (docs/sales.txt §5.1). The old one is
   * marked REPLACED and this one issued in the SAME transaction, with the two
   * serials written on each other — neither may exist alone.
   */
  replaces: z
    .object({
      receiptId: z.string().min(1),
      reason: z
        .string()
        .trim()
        .min(3, "Write the reason for the replacement.")
        .max(500),
    })
    .optional(),
});

export type CollectFromCustomerInput = z.infer<typeof collectFromCustomerInput>;

/** One credit on a customer's account — money held FOR them. */
export type CustomerCreditDto = {
  id: string;
  amount: string;
  applied: string;
  remaining: string;
  method: PaymentMethod;
  reference: string | null;
  receivedAt: string;
  status: "UNAPPLIED" | "PARTIALLY_APPLIED" | "FULLY_APPLIED";
  /** The collection whose excess created it. */
  sourceDocumentNo: string | null;
};

/** What the Collect dialog opens with. */
export type CollectOptionsDto = {
  customerId: string;
  customerName: string;
  customerAddress: string | null;
  customerTin: string | null;
  /** Open invoices across every job order, oldest first. */
  invoices: (OpenInvoiceDto & { joNumber: string | null })[];
  totalOutstanding: string;
  /** Credits with money left on them, oldest first. */
  credits: CustomerCreditDto[];
  creditAvailable: string;
  /** Next CR number, or null when no booklet is active. */
  nextCrNumber: string | null;
};

export type CollectResultDto = {
  id: string;
  /** Null when no Collection Receipt was printed. */
  documentNo: string | null;
  /** Tender taken in — what the day's collections count. */
  received: string;
  /** Total applied to invoices, tender plus any credit spent. */
  applied: string;
  /** Credit spent funding this payment. */
  creditUsed: string;
  /** Overpayment parked as new credit on the account. */
  creditCreated: string;
  /** Invoices this payment closed outright. */
  invoicesClosed: number;
  /** The serial this one supersedes, when it was issued as a replacement. */
  replacedDocumentNo: string | null;
};

/**
 * Set a customer's credit terms. Both fields clear with null: no terms and no
 * ceiling is the pre-existing behaviour, and must stay reachable.
 */
export const setCreditInput = z.object({
  customerId: z.string().min(1),
  /** Net days until a charge invoice falls due. Null = no terms. */
  creditTermDays: z.number().int().min(0).max(365).nullable(),
  /** Ceiling on total open A/R. Null = no ceiling. */
  creditLimit: money.nullable(),
});

export type SetCreditInput = z.infer<typeof setCreditInput>;

/** A payment on the customer's account, and what it went towards. */
export type CustomerPaymentDto = {
  id: string;
  documentNo: string | null;
  documentIssued: boolean;
  /** Tender taken in. Credit moved separately — see collection-receipt.prisma. */
  amount: string;
  method: PaymentMethod;
  methodDetail: string | null;
  receivedAt: string;
  createdByName: string;
  voidType: ReceiptVoidType | null;
  voidReason: string | null;
  voidedByName: string | null;
  /** The pair written on each other when a receipt is reissued — §5.1 step 3. */
  replacedByDocumentNo: string | null;
  replacesDocumentNo: string | null;
  jobOrderNo: string | null;
  /** Which invoices it settled, and for how much. */
  applied: { documentNo: string; amount: string }[];
  creditCreated: string;
  creditApplied: string;
};

/**
 * One customer's whole account: what they owe, what we hold for them, and
 * everything they have paid. The A/R ledger answers "who owes us"; this
 * answers "what has happened with this customer".
 */
export type CustomerAccountDto = {
  customerId: string;
  customerName: string;
  customerAddress: string | null;
  customerTin: string | null;
  /** Open invoices, oldest first, each in its aging bucket. */
  invoices: (OpenInvoiceDto & { joNumber: string | null; bucket: AgingBucket })[];
  totalOutstanding: string;
  aging: Record<AgingBucket, string>;
  /** Every credit, spent or not, newest first. */
  credits: CustomerCreditDto[];
  creditOnAccount: string;
  /** Payment history, newest first. Cancelled ones included and marked. */
  payments: CustomerPaymentDto[];
  creditTermDays: number | null;
  creditLimit: string | null;
  /** The billed entity, when this customer is a company contact. */
  companyId: string | null;
  companyName: string | null;
  /**
   * What the credit limit is measured against — this customer's own A/R for an
   * individual, the whole company's for a contact (docs/sales-contract.md R15).
   */
  exposure: string;
  /** limit − exposure; null when no ceiling is set. */
  creditAvailable: string | null;
  /**
   * Decided here rather than by the caller, so the customer profile and the A/R
   * ledger can never render different verdicts on the same customer.
   */
  overLimit: boolean;
  /** Mirrors the credit-control module flag. */
  creditControlEnabled: boolean;
};

export const receivableFilters = z.object({
  q: z.string().trim().max(200).optional(),
  /** Show only customers with something in this bucket. */
  bucket: z.enum(AGING_BUCKETS).optional(),
  /** Only customers past their credit limit. */
  overLimitOnly: z.coerce.boolean().optional(),
});

export type ReceivableFilters = z.infer<typeof receivableFilters>;
