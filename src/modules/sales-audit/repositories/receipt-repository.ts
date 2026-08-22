import { prisma } from "@/lib/prisma";
import { ConflictError } from "@/lib/errors";
import type { Prisma } from "@/generated/prisma/client";
import type {
  AuditEntryStatus,
  AuditFlagType,
  PaymentMethod,
  PaymentStatus,
  ReceiptVoidType,
  SaleType,
} from "@/generated/prisma/enums";
import type { DbTx } from "@/modules/shared/repositories/types";

// ——— selection shapes ———

// The auditor's latest sign-off rides along with every receipt row: the legacy
// sheet keeps verified_by on the transaction line itself.
const latestAudit = {
  select: {
    status: true,
    remarks: true,
    auditor: { select: { name: true } },
  },
  orderBy: { auditedAt: "desc" },
  take: 1,
} satisfies Prisma.Sale$auditEntriesArgs;

// Split-tender lines ride along with every receipt row: a receipt paid two
// ways is not readable from the header alone.
const paymentLines = {
  select: { method: true, amount: true, reference: true },
  orderBy: { seq: "asc" },
} satisfies Prisma.Sale$paymentsArgs;

const saleSelect = {
  id: true,
  documentNo: true,
  type: true,
  isDownpayment: true,
  amount: true,
  vatableSales: true,
  vatAmount: true,
  amountPaid: true,
  // Collected since issue. openBalance = amount − amountPaid − settledAmount.
  settledAmount: true,
  dueDate: true,
  paymentStatus: true,
  cashTendered: true,
  changeGiven: true,
  paymentMethod: true,
  methodDetail: true,
  saleDate: true,
  billedToName: true,
  customer: { select: { name: true } },
  jobOrder: { select: { joNumber: true } },
  createdBy: { select: { name: true } },
  auditEntries: latestAudit,
  payments: paymentLines,
  // A cancelled receipt still shows in every list — it has to, so all 50
  // leaves of the booklet can be accounted for (docs/sales.txt §4).
  voidType: true,
  voidReason: true,
  voidedAt: true,
  voidedBy: { select: { name: true } },
  replacedBy: { select: { documentNo: true } },
  replaces: { select: { documentNo: true } },
} satisfies Prisma.SaleSelect;

const crSelect = {
  id: true,
  crNumber: true,
  documentIssued: true,
  amount: true,
  cashTendered: true,
  changeGiven: true,
  method: true,
  methodDetail: true,
  receivedAt: true,
  billedToName: true,
  customer: { select: { name: true } },
  jobOrder: { select: { joNumber: true } },
  createdBy: { select: { name: true } },
  auditEntries: {
    select: {
      status: true,
      remarks: true,
      auditor: { select: { name: true } },
    },
    orderBy: { auditedAt: "desc" },
    take: 1,
  },
  payments: paymentLines,
  // Which invoices this collection paid down. Its presence is also what
  // distinguishes a modern collection from a legacy one written before
  // allocations existed — see positionOf in receipt-service.ts.
  allocations: { select: { saleId: true, amount: true } },
  voidType: true,
  voidReason: true,
  voidedAt: true,
  voidedBy: { select: { name: true } },
  replacedBy: { select: { crNumber: true } },
  replaces: { select: { crNumber: true } },
} satisfies Prisma.CollectionReceiptSelect;

const joForReceiptSelect = {
  id: true,
  joNumber: true,
  total: true,
  customer: {
    select: {
      id: true,
      name: true,
      address: true,
      tin: true,
      vatRegistered: true,
      // Credit control — read even when the flag is off, so the service can
      // decide; the flag is what makes it binding, not the absence of data.
      creditTermDays: true,
      creditLimit: true,
      // Withholding — needed to suggest the tax on this job's open invoices
      // when a collection is taken from inside the job-order dialog.
      isWithholdingAgent: true,
      ewtRatePct: true,
      withholdsVat: true,
      vatWithholdingRatePct: true,
    },
  },
  items: { select: { lineTotal: true } },
} satisfies Prisma.JobOrderSelect;

export type SaleRecord = Prisma.SaleGetPayload<{ select: typeof saleSelect }>;
export type CrRecord = Prisma.CollectionReceiptGetPayload<{
  select: typeof crSelect;
}>;
export type JoForReceiptRecord = Prisma.JobOrderGetPayload<{
  select: typeof joForReceiptSelect;
}>;

/** One tender line, ready to insert. `seq` is the counter's entry order. */
export type PaymentLineCreateData = {
  method: PaymentMethod;
  amount: string;
  reference: string | null;
  seq: number;
};

/** Money crosses this boundary as a string — Decimal(12,2), never a float. */
export type SaleCreateData = {
  documentNo: string;
  bookletId: string | null;
  type: SaleType;
  /** JO_SLIP only — a downpayment books a deposit, not revenue. */
  isDownpayment?: boolean;
  customerId: string;
  jobOrderId: string | null;
  saleDate: Date;
  amount: string;
  vatableSales: string;
  vatAmount: string;
  amountPaid: string;
  paymentStatus: PaymentStatus;
  /** SI_CHARGE only: saleDate + the customer's terms. Null on the rest. */
  dueDate: Date | null;
  cashTendered: string | null;
  changeGiven: string;
  /** Null on a pure credit sale — no money changed hands to have a method. */
  paymentMethod: PaymentMethod | null;
  methodDetail: string | null;
  billedToName: string | null;
  billedToAddress: string | null;
  billedToTin: string | null;
  notes: string | null;
  createdById: string;
  /** Split tender — always at least one line, summing to `amount`. */
  payments: PaymentLineCreateData[];
};

/** Which invoice a collection pays down, and by how much. */
export type AllocationCreateData = {
  saleId: string;
  /**
   * What this settles on the invoice — INCLUDING both withholdings below, so
   * a ₱112,000 invoice paid ₱105,000 net of ₱2,000 income tax and ₱5,000 VAT
   * closes in full.
   */
  amount: string;
  /**
   * Creditable INCOME tax withheld (BIR Form 2307) — 1% goods, 2% services.
   * Omit or "0" for the ordinary case.
   */
  ewtWithheld?: string;
  /**
   * Creditable VALUE-ADDED tax withheld (BIR Form 2306) — 5%, government and
   * LGU customers only. Kept apart from `ewtWithheld` because the two are
   * claimed on different returns.
   */
  vatWithheld?: string;
};

export type CrCreateData = {
  /** Null when the customer declined the printed CR — no serial is consumed. */
  crNumber: string | null;
  documentIssued: boolean;
  bookletId: string | null;
  customerId: string;
  jobOrderId: string | null;
  amount: string;
  method: PaymentMethod;
  methodDetail: string | null;
  cashTendered: string | null;
  changeGiven: string;
  billedToName: string | null;
  billedToAddress: string | null;
  billedToTin: string | null;
  receivedAt: Date;
  notes: string | null;
  createdById: string;
  /** Split tender — always at least one line, summing to `amount`. */
  payments: PaymentLineCreateData[];
  /** The invoices this money pays down. Sums to `amount` — "no floating CRs". */
  allocations: AllocationCreateData[];
};

export type AuditCreateData = {
  saleId: string | null;
  collectionReceiptId: string | null;
  status: AuditEntryStatus;
  flagType: AuditFlagType | null;
  remarks: string | null;
  auditorId: string;
};

export type ReceiptDayFilter = { from: Date; to: Date; q?: string };

/** `to` is EXCLUSIVE, matching the day filter above. */
export type SalesRangeQuery = {
  from: Date;
  to: Date;
  customerId?: string | null;
};

/**
 * One revenue document, stripped to what a sales report needs.
 *
 * Aggregation happens in the service rather than in SQL on purpose. Grouping
 * by month in Postgres means `date_trunc`, which buckets by the DATABASE's
 * timezone — and a sale made at 8am in Ormoc is the previous day in UTC, so a
 * July report would quietly leak its first hours into June. Every other date
 * boundary in this module is computed in the app's local time, and a report
 * that disagreed with the daily summary about which month a receipt fell in
 * would be worse than a slow one.
 */
export type SalesRangeRow = {
  saleDate: Date;
  type: SaleType;
  amount: string;
  vatableSales: string;
  vatAmount: string;
  /** JO_SLIP only — true means a deposit, false means the sale itself. */
  isDownpayment: boolean;
  customerId: string;
  customerName: string;
};

export type CollectionRangeRow = {
  receivedAt: Date;
  amount: string;
  customerId: string;
  customerName: string;
};

/** The mark written on a spoiled receipt, plus who signed it off. */
export type VoidMarkData = {
  type: ReceiptVoidType;
  reason: string;
  voidedById: string;
  /** Set only when a replacement was issued in the same transaction. */
  replacedById?: string;
};

/** A receipt as the void/replace flow needs to see it, either ledger. */
export type ReceiptForVoidRecord = {
  id: string;
  /** Null only for an undocumented collection — money in, no CR printed. */
  documentNo: string | null;
  jobOrderId: string | null;
  customerId: string;
  amount: string;
  voidedAt: Date | null;
  createdById: string;
};

/** A payment a customer made, and what it went towards. */
export type CustomerPaymentRecord = {
  id: string;
  crNumber: string | null;
  documentIssued: boolean;
  /** Tender taken in — not counting credit spent. See collection-receipt.prisma. */
  amount: string;
  method: PaymentMethod;
  methodDetail: string | null;
  receivedAt: Date;
  createdByName: string;
  voidType: ReceiptVoidType | null;
  voidReason: string | null;
  voidedByName: string | null;
  /** The pair written on each other when a receipt is reissued — §5.1 step 3. */
  replacedByDocumentNo: string | null;
  replacesDocumentNo: string | null;
  jobOrderNo: string | null;
  allocations: { documentNo: string; amount: string }[];
  /** Overpayment this parked on the account. */
  creditCreated: string;
  /** Credit on file this spent. */
  creditApplied: string;
};

/** One customer's A/R position, for the ledger list and the credit check. */
export type ReceivableRecord = {
  id: string;
  documentNo: string;
  type: SaleType;
  saleDate: Date;
  dueDate: Date | null;
  amount: string;
  amountPaid: string;
  settledAmount: string;
  /**
   * VAT-exclusive amount, frozen at issue. The ONLY correct base for expanded
   * withholding tax — see `computeWithholding` in services/money.ts. Carried on the
   * receivable rather than recomputed, because the rate must be applied to
   * what the invoice actually said (R10).
   */
  vatableSales: string;
  jobOrderNo: string | null;
  customer: {
    id: string;
    name: string;
    address: string | null;
    tin: string | null;
    creditTermDays: number | null;
    creditLimit: string | null;
    /** True → withholds creditable INCOME tax and issues a BIR 2307. */
    isWithholdingAgent: boolean;
    /** Rate on the VAT-exclusive amount, e.g. "2.00". Null = no default. */
    ewtRatePct: string | null;
    /** True → withholds 5% creditable VAT and issues a BIR 2306. Government. */
    withholdsVat: boolean;
    /** Usually "5.00". Null = flagged but nothing pre-filled. */
    vatWithholdingRatePct: string | null;
    /**
     * The billed entity, when this customer is a company contact.
     *
     * Company billing (TIN, terms, ceiling) is denormalised onto every contact
     * by syncBillingToContacts, so `creditLimit` above is the COMPANY's ceiling
     * copied down — not this person's share of it. Aggregating exposure per
     * contact therefore grants the ceiling once per contact: a company with a
     * ₱100k limit and five contacts carries ₱500k. Grouping by this id is what
     * makes the ceiling company-wide, as it was always meant to be
     * (docs/sales-contract.md R15).
     */
    companyId: string | null;
    companyName: string | null;
  };
};

const receivableSelect = {
  id: true,
  documentNo: true,
  type: true,
  saleDate: true,
  dueDate: true,
  amount: true,
  amountPaid: true,
  settledAmount: true,
  vatableSales: true,
  jobOrder: { select: { joNumber: true } },
  customer: {
    select: {
      id: true,
      name: true,
      address: true,
      tin: true,
      creditTermDays: true,
      creditLimit: true,
      isWithholdingAgent: true,
      ewtRatePct: true,
      withholdsVat: true,
      vatWithholdingRatePct: true,
      companyId: true,
      companyRef: { select: { name: true, creditLimit: true } },
    },
  },
} as const;

const RECEIVABLE_ORDER = [
  { saleDate: "asc" as const },
  { id: "asc" as const },
];

type ReceivableRow = {
  id: string;
  documentNo: string;
  type: SaleType;
  saleDate: Date;
  dueDate: Date | null;
  amount: unknown;
  amountPaid: unknown;
  settledAmount: unknown;
  vatableSales: unknown;
  jobOrder: { joNumber: string } | null;
  customer: {
    id: string;
    name: string;
    address: string | null;
    tin: string | null;
    creditTermDays: number | null;
    creditLimit: unknown;
    isWithholdingAgent: boolean;
    ewtRatePct: unknown;
    withholdsVat: boolean;
    vatWithholdingRatePct: unknown;
    companyId: string | null;
    companyRef: { name: string; creditLimit: unknown } | null;
  };
};

/**
 * `settled` is passed in rather than read off the row: today's ledger uses the
 * denormalised running total, an as-of report uses only the collections that
 * had arrived by that date. Everything else about the invoice is the same.
 */
function toReceivable(r: ReceivableRow, settled: string): ReceivableRecord {
  return {
    id: r.id,
    documentNo: r.documentNo,
    type: r.type,
    saleDate: r.saleDate,
    dueDate: r.dueDate,
    amount: String(r.amount),
    amountPaid: String(r.amountPaid),
    settledAmount: settled,
    vatableSales: String(r.vatableSales),
    jobOrderNo: r.jobOrder?.joNumber ?? null,
    customer: {
      id: r.customer.id,
      name: r.customer.name,
      address: r.customer.address,
      tin: r.customer.tin,
      creditTermDays: r.customer.creditTermDays,
      isWithholdingAgent: r.customer.isWithholdingAgent,
      ewtRatePct:
        r.customer.ewtRatePct === null ? null : String(r.customer.ewtRatePct),
      withholdsVat: r.customer.withholdsVat,
      vatWithholdingRatePct:
        r.customer.vatWithholdingRatePct === null
          ? null
          : String(r.customer.vatWithholdingRatePct),
      // For a contact, the ceiling is read from the COMPANY rather than from
      // the copy denormalised onto them: the copy drifts if a sync is missed,
      // and the company row is the one an admin actually edits.
      creditLimit:
        r.customer.companyRef?.creditLimit != null
          ? String(r.customer.companyRef.creditLimit)
          : r.customer.creditLimit != null
            ? String(r.customer.creditLimit)
            : null,
      companyId: r.customer.companyId,
      companyName: r.customer.companyRef?.name ?? null,
    },
  };
}

export interface IReceiptRepository {
  withTransaction<T>(fn: (tx: DbTx) => Promise<T>): Promise<T>;
  findJobOrder(jobOrderId: string): Promise<JoForReceiptRecord | null>;
  createSale(data: SaleCreateData, tx: DbTx): Promise<{ id: string }>;
  createCr(data: CrCreateData, tx: DbTx): Promise<{ id: string }>;
  /** Every receipt raised against one JO — both ledgers. */
  listByJobOrder(
    jobOrderId: string
  ): Promise<{ sales: SaleRecord[]; crs: CrRecord[] }>;
  /** The day's receipts — the legacy daily sales log. */
  listByDay(
    filter: ReceiptDayFilter
  ): Promise<{ sales: SaleRecord[]; crs: CrRecord[] }>;
  findSale(id: string): Promise<{ id: string } | null>;
  findCr(id: string): Promise<{ id: string } | null>;
  createAuditEntry(data: AuditCreateData): Promise<{ id: string }>;
  /** The receipt about to be cancelled — either ledger, same shape. */
  findSaleForVoid(id: string): Promise<ReceiptForVoidRecord | null>;
  findCrForVoid(id: string): Promise<ReceiptForVoidRecord | null>;
  markSaleVoid(id: string, data: VoidMarkData, tx: DbTx): Promise<void>;
  markCrVoid(id: string, data: VoidMarkData, tx: DbTx): Promise<void>;

  // ——— accounts receivable ———

  /**
   * Every invoice that could still be owed on: charge invoices, plus any older
   * partially-paid invoice from before "an invoice is always fully paid".
   *
   * `paymentStatus` records the position AT ISSUE and is never rewritten, so
   * it is a safe SUPERSET filter — invoices since settled by a collection are
   * still returned here and dropped by the caller, which computes the open
   * balance. Narrowing it in SQL would need `amount − amountPaid −
   * settledAmount > 0`, a three-column comparison Prisma cannot express.
   */
  /**
   * `asOf` rewinds the ledger to a past date: invoices issued by then, minus
   * only the collections that had arrived by then. Aging "as at 30 June" needs
   * this — filtering today's open invoices by date answers a different and
   * much smaller question. Omit it for today.
   */
  listReceivables(
    customerId?: string,
    asOf?: Date
  ): Promise<ReceivableRecord[]>;

  /**
   * Every payment a customer has made, newest first, with the invoices each
   * one settled. Cancelled payments are included and marked — the same rule
   * the day log follows: a payment that happened is never hidden.
   */
  listPaymentsForCustomer(customerId: string): Promise<CustomerPaymentRecord[]>;

  /**
   * Revenue documents over a date range, lean — five columns, no `take` cap.
   *
   * Deliberately NOT `listByDay` with a wider window: that one is also the
   * cancellation log, so it returns voided receipts and caps at 500 rows.
   * Both are right for a day and wrong for a year — a sales report that counts
   * spoiled receipts overstates revenue, and one that stops at 500 rows
   * silently reports a fraction of the month.
   */
  listSalesInRange(q: SalesRangeQuery): Promise<SalesRangeRow[]>;

  /**
   * Cash collected in the range. Reported beside sales and never inside them:
   * the revenue was booked by the invoice, so counting the collection again
   * would double it (R4).
   */
  listCollectionsInRange(q: SalesRangeQuery): Promise<CollectionRangeRow[]>;

  /** Record a collection against invoices and close down their balances. */
  allocate(
    crId: string,
    allocations: AllocationCreateData[],
    tx: DbTx
  ): Promise<void>;

  /**
   * Undo a cancelled collection's allocations — the receivable reopens.
   * Without this a voided CR would leave the invoices it touched looking paid.
   */
  reverseAllocations(crId: string, tx: DbTx): Promise<void>;

  /** How many live collections have been applied to this invoice. */
  countAllocationsForSale(saleId: string): Promise<number>;

  /**
   * What one collection paid down. Needed when planning its REPLACEMENT: the
   * old allocations are still in place while the new payment is being worked
   * out, so the invoices look more settled than they are about to be, and the
   * replacement would be capped too low.
   */
  listAllocations(
    crId: string
  ): Promise<{ saleId: string; amount: string; ewtWithheld: string; vatWithheld: string }[]>;
}

export class PrismaReceiptRepository implements IReceiptRepository {
  withTransaction<T>(fn: (tx: DbTx) => Promise<T>): Promise<T> {
    return prisma.$transaction(fn);
  }

  async findJobOrder(jobOrderId: string): Promise<JoForReceiptRecord | null> {
    return prisma.jobOrder.findFirst({
      where: { id: jobOrderId, deletedAt: null },
      select: joForReceiptSelect,
    });
  }

  async createSale(data: SaleCreateData, tx: DbTx): Promise<{ id: string }> {
    const { payments, ...header } = data;
    return tx.sale.create({
      data: { ...header, payments: { create: payments } },
      select: { id: true },
    });
  }

  async createCr(data: CrCreateData, tx: DbTx): Promise<{ id: string }> {
    // Allocations are applied by `allocate` rather than nested here, so the
    // matching settledAmount bumps ride in the same call and cannot drift.
    const { payments, allocations, ...header } = data;
    const created = await tx.collectionReceipt.create({
      data: { ...header, payments: { create: payments } },
      select: { id: true },
    });
    if (allocations.length > 0) {
      await this.allocate(created.id, allocations, tx);
    }
    return created;
  }

  async listByJobOrder(
    jobOrderId: string
  ): Promise<{ sales: SaleRecord[]; crs: CrRecord[] }> {
    // A job order's receipt history INCLUDES its cancellations — the void
    // reason and the replacement pairing are what the cashier is looking at.
    // Callers that need revenue rather than history filter on voidedAt
    // themselves; this is the document trail, not the ledger.
    const [sales, crs] = await Promise.all([
      // contract:allow R2 — the JO receipt trail shows voided receipts on purpose
      prisma.sale.findMany({
        where: { jobOrderId, deletedAt: null },
        select: saleSelect,
        orderBy: { saleDate: "desc" },
      }),
      // contract:allow R2 — the JO receipt trail shows voided collections on purpose
      prisma.collectionReceipt.findMany({
        where: { jobOrderId, deletedAt: null },
        select: crSelect,
        orderBy: { receivedAt: "desc" },
      }),
    ]);
    return { sales, crs };
  }

  async listByDay(
    filter: ReceiptDayFilter
  ): Promise<{ sales: SaleRecord[]; crs: CrRecord[] }> {
    const { from, to, q } = filter;
    const saleWhere: Prisma.SaleWhereInput = {
      deletedAt: null,
      saleDate: { gte: from, lt: to },
    };
    const crWhere: Prisma.CollectionReceiptWhereInput = {
      deletedAt: null,
      receivedAt: { gte: from, lt: to },
    };
    if (q) {
      // Searching a serial also returns the receipt it replaced and the one
      // issued in its place. §5.1 step 3 pairs the two, and an auditor
      // reconciling a booklet needs to see them together — looking one up and
      // getting a single row hides exactly the relationship being checked.
      saleWhere.OR = [
        { documentNo: { contains: q, mode: "insensitive" } },
        { replacedBy: { documentNo: { contains: q, mode: "insensitive" } } },
        { replaces: { documentNo: { contains: q, mode: "insensitive" } } },
        { customer: { name: { contains: q, mode: "insensitive" } } },
        { jobOrder: { joNumber: { contains: q, mode: "insensitive" } } },
      ];
      crWhere.OR = [
        { crNumber: { contains: q, mode: "insensitive" } },
        { replacedBy: { crNumber: { contains: q, mode: "insensitive" } } },
        { replaces: { crNumber: { contains: q, mode: "insensitive" } } },
        { customer: { name: { contains: q, mode: "insensitive" } } },
        { jobOrder: { joNumber: { contains: q, mode: "insensitive" } } },
      ];
    }
    // The day's receipts INCLUDE the cancelled ones. §5.1 step 5 makes the
    // cancellation log a scan of the day's voided receipts, and an auditor
    // reconciling a booklet against the day needs every serial that was used —
    // spoiled or not. The view marks them; the totals exclude them.
    const [sales, crs] = await Promise.all([
      // contract:allow R2 — the daily view IS the cancellation log; it must show voids
      prisma.sale.findMany({
        where: saleWhere,
        select: saleSelect,
        orderBy: [{ saleDate: "desc" }, { id: "desc" }],
        take: 500,
      }),
      // contract:allow R2 — same: voided collections appear in the day's log
      prisma.collectionReceipt.findMany({
        where: crWhere,
        select: crSelect,
        orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
        take: 500,
      }),
    ]);
    return { sales, crs };
  }

  // Existence lookups for void / audit operations. An auditor signs off on a
  // CANCELLED receipt as readily as a live one — §5.1 wants the cancellation
  // itself initialled — so these must resolve voided rows.
  // contract:allow R2 — you audit and void receipts that are already voided
  async findSale(id: string): Promise<{ id: string } | null> {
    return prisma.sale.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
  }

  // contract:allow R2 — same: a voided CR is still an auditable document
  async findCr(id: string): Promise<{ id: string } | null> {
    return prisma.collectionReceipt.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
  }

  async createAuditEntry(data: AuditCreateData): Promise<{ id: string }> {
    return prisma.auditEntry.create({ data, select: { id: true } });
  }

  async findSaleForVoid(id: string): Promise<ReceiptForVoidRecord | null> {
    const s = await prisma.sale.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        documentNo: true,
        jobOrderId: true,
        customerId: true,
        amount: true,
        voidedAt: true,
        createdById: true,
      },
    });
    return s && { ...s, amount: s.amount.toString() };
  }

  async findCrForVoid(id: string): Promise<ReceiptForVoidRecord | null> {
    const c = await prisma.collectionReceipt.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        crNumber: true,
        jobOrderId: true,
        customerId: true,
        amount: true,
        voidedAt: true,
        createdById: true,
      },
    });
    return c && { ...c, documentNo: c.crNumber, amount: c.amount.toString() };
  }

  // ——— accounts receivable ———

  // Oldest first: an A/R ledger is read from the stalest debt down, and that
  // is also the order collections are applied in.
  //
  // By saleDate, NOT dueDate: Postgres sorts NULLs last, so ordering by due
  // date would push every invoice with no agreed terms below newer dated ones
  // — the exact opposite of oldest-first.

  async listReceivables(
    customerId?: string,
    asOf?: Date
  ): Promise<ReceivableRecord[]> {
    // ── LIVE ──────────────────────────────────────────────────────────
    // Today's ledger reads the denormalised `settledAmount`, and narrows to
    // UNPAID / PARTIAL as a cheap superset — invoices settled by a later
    // collection come back too and are dropped by their computed balance.
    if (!asOf) {
      const rows = await prisma.sale.findMany({
        where: {
          deletedAt: null,
          voidedAt: null,
          ...(customerId ? { customerId } : {}),
          paymentStatus: { in: ["UNPAID", "PARTIAL"] },
        },
        select: receivableSelect,
        orderBy: RECEIVABLE_ORDER,
      });
      return rows.map((r) => toReceivable(r, r.settledAmount.toString()));
    }

    // ── AS OF A PAST DATE ─────────────────────────────────────────────
    // Aging "as at 30 June" is a RECONSTRUCTION, not a filter. Three things
    // the live query does are wrong for it, and each one silently understates
    // what was owed:
    //
    //   • `paymentStatus` is today's. An invoice settled in August was still
    //     owed in June, and the live filter would drop it.
    //   • `voidedAt: null` is today's. An invoice voided in August was live
    //     in June — it belongs in June's report.
    //   • `settledAmount` is today's running total. June's figure counts only
    //     the collections that had actually arrived by June.
    //
    // Known limit, worth stating rather than hiding: cancelling a collection
    // DELETES its allocation rows (see reverseAllocations), so a June payment
    // cancelled in August leaves the invoice reading as open in June. That is
    // the more honest answer for a receivables report — the money never came —
    // but it does mean this report is not a byte-exact replay of what the
    // screen showed on the day.
    const rows = await prisma.sale.findMany({
      where: {
        deletedAt: null,
        ...(customerId ? { customerId } : {}),
        saleDate: { lte: asOf },
        OR: [{ voidedAt: null }, { voidedAt: { gt: asOf } }],
      },
      select: {
        ...receivableSelect,
        crAllocations: {
          where: {
            cr: {
              deletedAt: null,
              // A collection cancelled on or before the as-of date had already
              // stopped paying for anything by then.
              OR: [{ voidedAt: null }, { voidedAt: { gt: asOf } }],
              receivedAt: { lte: asOf },
            },
          },
          select: { amount: true },
        },
      },
      orderBy: RECEIVABLE_ORDER,
    });

    return rows.map((r) => {
      const settledByThen = r.crAllocations.reduce(
        (t, a) => t + Math.round(parseFloat(a.amount.toString()) * 100),
        0
      );
      return toReceivable(
        r,
        `${Math.floor(settledByThen / 100)}.${String(settledByThen % 100).padStart(2, "0")}`
      );
    });
  }

  async listSalesInRange(q: SalesRangeQuery): Promise<SalesRangeRow[]> {
    const rows = await prisma.sale.findMany({
      where: {
        deletedAt: null,
        // A voided invoice is not a sale. Unlike the daily log — which IS the
        // cancellation log and must show them — a revenue report that counted
        // spoiled receipts would overstate both gross sales and the VAT on it.
        voidedAt: null,
        saleDate: { gte: q.from, lt: q.to },
        ...(q.customerId ? { customerId: q.customerId } : {}),
      },
      select: {
        saleDate: true,
        type: true,
        amount: true,
        vatableSales: true,
        vatAmount: true,
        isDownpayment: true,
        customerId: true,
        customer: { select: { name: true } },
      },
      orderBy: [{ saleDate: "asc" }, { id: "asc" }],
    });
    return rows.map((r) => ({
      saleDate: r.saleDate,
      type: r.type,
      amount: r.amount.toString(),
      vatableSales: r.vatableSales.toString(),
      vatAmount: r.vatAmount.toString(),
      isDownpayment: r.isDownpayment,
      customerId: r.customerId,
      customerName: r.customer.name,
    }));
  }

  async listCollectionsInRange(
    q: SalesRangeQuery
  ): Promise<CollectionRangeRow[]> {
    const rows = await prisma.collectionReceipt.findMany({
      where: {
        deletedAt: null,
        voidedAt: null,
        receivedAt: { gte: q.from, lt: q.to },
        ...(q.customerId ? { customerId: q.customerId } : {}),
      },
      select: {
        receivedAt: true,
        amount: true,
        customerId: true,
        customer: { select: { name: true } },
      },
      orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
    });
    return rows.map((r) => ({
      receivedAt: r.receivedAt,
      amount: r.amount.toString(),
      customerId: r.customerId,
      customerName: r.customer.name,
    }));
  }

  // A customer's payment history shows cancelled payments too, with their void
  // reason and who approved it — that record is precisely what a customer
  // disputing their balance is shown. The DTO carries voidType / voidReason /
  // voidedByName for exactly this. A/R totals come from open invoices, not from
  // this list, so including voided rows here cannot inflate a balance.
  // contract:allow R2 — payment history is a document trail, not a balance
  async listPaymentsForCustomer(
    customerId: string
  ): Promise<CustomerPaymentRecord[]> {
    const rows = await prisma.collectionReceipt.findMany({
      where: { customerId, deletedAt: null },
      select: {
        id: true,
        crNumber: true,
        documentIssued: true,
        amount: true,
        method: true,
        methodDetail: true,
        receivedAt: true,
        voidType: true,
        voidReason: true,
        voidedBy: { select: { name: true } },
        replacedBy: { select: { crNumber: true } },
        replaces: { select: { crNumber: true } },
        createdBy: { select: { name: true } },
        jobOrder: { select: { joNumber: true } },
        allocations: {
          select: { amount: true, sale: { select: { documentNo: true } } },
        },
        creditsCreated: { where: { deletedAt: null }, select: { amount: true } },
        creditsApplied: { select: { amount: true } },
      },
      orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
      take: 200,
    });

    const sum = (xs: { amount: unknown }[]) =>
      xs.reduce((t, x) => t + Math.round(parseFloat(String(x.amount)) * 100), 0);
    const money = (c: number) =>
      `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;

    return rows.map((r) => ({
      id: r.id,
      crNumber: r.crNumber,
      documentIssued: r.documentIssued,
      amount: r.amount.toString(),
      method: r.method,
      methodDetail: r.methodDetail,
      receivedAt: r.receivedAt,
      createdByName: r.createdBy.name,
      voidType: r.voidType,
      voidReason: r.voidReason,
      voidedByName: r.voidedBy?.name ?? null,
      replacedByDocumentNo: r.replacedBy?.crNumber ?? null,
      replacesDocumentNo: r.replaces?.crNumber ?? null,
      jobOrderNo: r.jobOrder?.joNumber ?? null,
      allocations: r.allocations.map((a) => ({
        documentNo: a.sale.documentNo,
        amount: a.amount.toString(),
      })),
      creditCreated: money(sum(r.creditsCreated)),
      creditApplied: money(sum(r.creditsApplied)),
    }));
  }

  async allocate(
    crId: string,
    allocations: AllocationCreateData[],
    tx: DbTx
  ): Promise<void> {
    for (const a of allocations) {
      // The open balance is re-checked HERE, inside the transaction, as part
      // of the same statement that increments it.
      //
      // The service already capped the collection at what was outstanding,
      // but it read that a moment earlier and outside any lock: two cashiers
      // collecting the last ₱500 of one invoice at the same instant would
      // both pass that check and settle ₱1,000 against a ₱500 debt. The
      // WHERE clause makes the check and the write atomic — Postgres locks
      // the row for the update, so the second one matches nothing and we
      // raise instead of silently over-collecting.
      const applied = await tx.$executeRaw`
        UPDATE "Sale"
           SET "settledAmount" = "settledAmount" + ${a.amount}::decimal
         WHERE "id" = ${a.saleId}
           AND "amount" - "amountPaid" - "settledAmount" >= ${a.amount}::decimal
      `;
      if (applied === 0) {
        throw new ConflictError(
          "That invoice was collected against while this payment was being entered. Reopen the job order and try again."
        );
      }
      await tx.crAllocation.create({
        data: {
          crId,
          saleId: a.saleId,
          amount: a.amount,
          // The withheld parts ride on the same row as the amount they are
          // part of, so they can never be written apart and disagree.
          ewtWithheld: a.ewtWithheld ?? "0",
          vatWithheld: a.vatWithheld ?? "0",
        },
      });
    }
  }

  async reverseAllocations(crId: string, tx: DbTx): Promise<void> {
    const rows = await tx.crAllocation.findMany({
      where: { crId },
      select: { saleId: true, amount: true },
    });
    for (const a of rows) {
      await tx.sale.update({
        where: { id: a.saleId },
        data: { settledAmount: { decrement: a.amount } },
      });
    }
    // The allocation rows go with the cancellation: the CR itself survives
    // (struck through, serial intact) but it no longer pays for anything.
    await tx.crAllocation.deleteMany({ where: { crId } });
  }

  async listAllocations(
    crId: string
  ): Promise<{ saleId: string; amount: string; ewtWithheld: string; vatWithheld: string }[]> {
    const rows = await prisma.crAllocation.findMany({
      where: { crId },
      select: { saleId: true, amount: true, ewtWithheld: true, vatWithheld: true },
    });
    return rows.map((r) => ({
      saleId: r.saleId,
      amount: r.amount.toString(),
      ewtWithheld: r.ewtWithheld.toString(),
      vatWithheld: r.vatWithheld.toString(),
    }));
  }

  async countAllocationsForSale(saleId: string): Promise<number> {
    return prisma.crAllocation.count({
      where: { saleId, cr: { voidedAt: null, deletedAt: null } },
    });
  }

  async markSaleVoid(id: string, data: VoidMarkData, tx: DbTx): Promise<void> {
    await tx.sale.update({
      where: { id },
      data: {
        voidType: data.type,
        voidReason: data.reason,
        voidedAt: new Date(),
        voidedById: data.voidedById,
        replacedById: data.replacedById ?? null,
      },
    });
  }

  async markCrVoid(id: string, data: VoidMarkData, tx: DbTx): Promise<void> {
    await tx.collectionReceipt.update({
      where: { id },
      data: {
        voidType: data.type,
        voidReason: data.reason,
        voidedAt: new Date(),
        voidedById: data.voidedById,
        replacedById: data.replacedById ?? null,
      },
    });
  }
}
