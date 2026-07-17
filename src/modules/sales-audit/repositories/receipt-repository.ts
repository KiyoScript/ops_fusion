import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type {
  AuditEntryStatus,
  AuditFlagType,
  PaymentMethod,
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

const saleSelect = {
  id: true,
  documentNo: true,
  type: true,
  amount: true,
  vatableSales: true,
  vatAmount: true,
  amountPaid: true,
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
  cashTendered: string | null;
  changeGiven: string;
  paymentMethod: PaymentMethod;
  methodDetail: string | null;
  billedToName: string | null;
  billedToAddress: string | null;
  billedToTin: string | null;
  notes: string | null;
  createdById: string;
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
    return tx.sale.create({ data, select: { id: true } });
  }

  async createCr(data: CrCreateData, tx: DbTx): Promise<{ id: string }> {
    return tx.collectionReceipt.create({ data, select: { id: true } });
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
}
