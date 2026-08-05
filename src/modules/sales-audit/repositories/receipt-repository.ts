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
  amount: string;
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
  jobOrderNo: string | null;
  customer: {
    id: string;
    name: string;
    address: string | null;
    tin: string | null;
    creditTermDays: number | null;
    creditLimit: string | null;
  };
};

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
  listReceivables(customerId?: string): Promise<ReceivableRecord[]>;

  /**
   * Every payment a customer has made, newest first, with the invoices each
   * one settled. Cancelled payments are included and marked — the same rule
   * the day log follows: a payment that happened is never hidden.
   */
  listPaymentsForCustomer(customerId: string): Promise<CustomerPaymentRecord[]>;

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
    const [sales, crs] = await Promise.all([
      prisma.sale.findMany({
        where: { jobOrderId, deletedAt: null },
        select: saleSelect,
        orderBy: { saleDate: "desc" },
      }),
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
      saleWhere.OR = [
        { documentNo: { contains: q, mode: "insensitive" } },
        { customer: { name: { contains: q, mode: "insensitive" } } },
        { jobOrder: { joNumber: { contains: q, mode: "insensitive" } } },
      ];
      crWhere.OR = [
        { crNumber: { contains: q, mode: "insensitive" } },
        { customer: { name: { contains: q, mode: "insensitive" } } },
        { jobOrder: { joNumber: { contains: q, mode: "insensitive" } } },
      ];
    }
    const [sales, crs] = await Promise.all([
      prisma.sale.findMany({
        where: saleWhere,
        select: saleSelect,
        orderBy: [{ saleDate: "desc" }, { id: "desc" }],
        take: 500,
      }),
      prisma.collectionReceipt.findMany({
        where: crWhere,
        select: crSelect,
        orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
        take: 500,
      }),
    ]);
    return { sales, crs };
  }

  async findSale(id: string): Promise<{ id: string } | null> {
    return prisma.sale.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
  }

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

  async listReceivables(customerId?: string): Promise<ReceivableRecord[]> {
    const rows = await prisma.sale.findMany({
      where: {
        deletedAt: null,
        voidedAt: null,
        ...(customerId ? { customerId } : {}),
        paymentStatus: { in: ["UNPAID", "PARTIAL"] },
      },
      select: {
        id: true,
        documentNo: true,
        type: true,
        saleDate: true,
        dueDate: true,
        amount: true,
        amountPaid: true,
        settledAmount: true,
        jobOrder: { select: { joNumber: true } },
        customer: {
          select: {
            id: true,
            name: true,
            address: true,
            tin: true,
            creditTermDays: true,
            creditLimit: true,
          },
        },
      },
      // Oldest first: an A/R ledger is read from the stalest debt down, and
      // that is also the order collections are applied in.
      //
      // By saleDate, NOT dueDate: Postgres sorts NULLs last, so ordering by
      // due date would push every invoice with no agreed terms below newer
      // dated ones — the exact opposite of oldest-first.
      orderBy: [{ saleDate: "asc" }, { id: "asc" }],
    });

    return rows.map((r) => ({
      id: r.id,
      documentNo: r.documentNo,
      type: r.type,
      saleDate: r.saleDate,
      dueDate: r.dueDate,
      amount: r.amount.toString(),
      amountPaid: r.amountPaid.toString(),
      settledAmount: r.settledAmount.toString(),
      jobOrderNo: r.jobOrder?.joNumber ?? null,
      customer: {
        id: r.customer.id,
        name: r.customer.name,
        address: r.customer.address,
        tin: r.customer.tin,
        creditTermDays: r.customer.creditTermDays,
        creditLimit: r.customer.creditLimit?.toString() ?? null,
      },
    }));
  }

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
        data: { crId, saleId: a.saleId, amount: a.amount },
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
