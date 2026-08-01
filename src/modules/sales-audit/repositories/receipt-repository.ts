import { prisma } from "@/lib/prisma";
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

export type CrCreateData = {
  crNumber: string;
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
  documentNo: string;
  jobOrderId: string | null;
  customerId: string;
  amount: string;
  voidedAt: Date | null;
  createdById: string;
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
    const { payments, ...header } = data;
    return tx.collectionReceipt.create({
      data: { ...header, payments: { create: payments } },
      select: { id: true },
    });
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
