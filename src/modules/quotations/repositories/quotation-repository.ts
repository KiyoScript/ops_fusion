import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { QuotationStatus, type TaxType } from "@/generated/prisma/enums";
import type { DbTx } from "@/modules/shared/repositories/types";

// ——— selection shapes (single source of truth for what queries fetch) ———

const listSelect = {
  id: true,
  quoteNumber: true,
  status: true,
  total: true,
  validUntil: true,
  createdAt: true,
  customer: { select: { name: true } },
  createdBy: { select: { name: true } },
  _count: { select: { items: true } },
} satisfies Prisma.QuotationSelect;

const detailSelect = {
  id: true,
  quoteNumber: true,
  status: true,
  validUntil: true,
  subtotal: true,
  discount: true,
  taxType: true,
  taxAmount: true,
  total: true,
  paymentTermLabel: true,
  downpaymentRate: true,
  notes: true,
  sentAt: true,
  approvedAt: true,
  rejectedReason: true,
  createdAt: true,
  customer: {
    select: {
      id: true,
      name: true,
      contactNumber: true,
      email: true,
      address: true,
    },
  },
  approvedBy: { select: { name: true } },
  createdBy: { select: { name: true } },
  items: { orderBy: { sortOrder: "asc" as const } },
  jobOrder: { select: { id: true, joNumber: true } },
} satisfies Prisma.QuotationSelect;

export type QuotationListRecord = Prisma.QuotationGetPayload<{
  select: typeof listSelect;
}>;
export type QuotationDetailRecord = Prisma.QuotationGetPayload<{
  select: typeof detailSelect;
}>;
export type QuotationItemRecord = QuotationDetailRecord["items"][number];

// ——— write payloads (plain data in, no Prisma types leak to services) ———

export type ItemCreateData = {
  productId?: string | null;
  description: string;
  qty: number;
  unitPrice: string;
  discount: string;
  lineTotal: string;
  specs?: Prisma.InputJsonValue;
  sortOrder: number;
};

export type ItemUpdateData = ItemCreateData;

export type QuotationCreateData = {
  quoteNumber: string;
  customerId: string;
  status: QuotationStatus;
  validUntil?: Date | null;
  subtotal: string;
  discount: string;
  taxType: TaxType;
  taxAmount: string;
  total: string;
  paymentTermLabel?: string | null;
  downpaymentRate: string;
  notes?: string | null;
  createdById: string;
  items: ItemCreateData[];
};

export type QuotationHeaderUpdateData = {
  customerId?: string;
  validUntil?: Date | null;
  subtotal?: string;
  discount?: string;
  taxType?: TaxType;
  taxAmount?: string;
  total?: string;
  paymentTermLabel?: string | null;
  downpaymentRate?: string;
  notes?: string | null;
};

// Lifecycle writes set/clear the audit fields together with the status so a
// re-submitted quote never carries stale approval data.
export type StatusSetData = {
  status: QuotationStatus;
  sentAt?: Date | null;
  approvedById?: string | null;
  approvedAt?: Date | null;
  rejectedReason?: string | null;
};

export type ListFilter = {
  q?: string;
  status:
    | "open"
    | "all"
    | "DRAFT"
    | "PENDING_APPROVAL"
    | "APPROVED"
    | "SENT"
    | "REJECTED"
    | "CONVERTED";
  cursor?: string;
  take: number;
};

const OPEN_STATUSES: QuotationStatus[] = [
  QuotationStatus.DRAFT,
  QuotationStatus.PENDING_APPROVAL,
  QuotationStatus.APPROVED,
  QuotationStatus.SENT,
];

export interface IQuotationRepository {
  withTransaction<T>(fn: (tx: DbTx) => Promise<T>): Promise<T>;
  listPage(
    filter: ListFilter
  ): Promise<{ rows: QuotationListRecord[]; nextCursor: string | null }>;
  findDetail(id: string): Promise<QuotationDetailRecord | null>;
  /** Atomically increments and returns the named counter (quote numbering). */
  nextCounter(key: string, tx?: DbTx): Promise<number>;
  createWithItems(
    data: QuotationCreateData,
    tx?: DbTx
  ): Promise<{ id: string; quoteNumber: string }>;
  updateHeader(
    id: string,
    data: QuotationHeaderUpdateData,
    tx?: DbTx
  ): Promise<void>;
  replaceItems(
    quotationId: string,
    ops: {
      create: ItemCreateData[];
      update: { id: string; data: ItemUpdateData }[];
      deleteIds: string[];
    },
    tx?: DbTx
  ): Promise<void>;
  setStatus(id: string, data: StatusSetData, tx?: DbTx): Promise<void>;
  softDelete(id: string, tx?: DbTx): Promise<void>;
}

export class PrismaQuotationRepository implements IQuotationRepository {
  withTransaction<T>(fn: (tx: DbTx) => Promise<T>): Promise<T> {
    return prisma.$transaction(fn);
  }

  async listPage(
    filter: ListFilter
  ): Promise<{ rows: QuotationListRecord[]; nextCursor: string | null }> {
    const where: Prisma.QuotationWhereInput = { deletedAt: null };

    if (filter.q) {
      where.OR = [
        { quoteNumber: { contains: filter.q, mode: "insensitive" } },
        { customer: { name: { contains: filter.q, mode: "insensitive" } } },
      ];
    }

    if (filter.status === "open") {
      where.status = { in: OPEN_STATUSES };
    } else if (filter.status !== "all") {
      where.status = filter.status as QuotationStatus;
    }

    const rows = await prisma.quotation.findMany({
      where,
      select: listSelect,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: filter.take + 1,
      ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > filter.take;
    const page = hasMore ? rows.slice(0, filter.take) : rows;
    return {
      rows: page,
      nextCursor: hasMore ? page[page.length - 1]!.id : null,
    };
  }

  async findDetail(id: string): Promise<QuotationDetailRecord | null> {
    return prisma.quotation.findFirst({
      where: { id, deletedAt: null },
      select: detailSelect,
    });
  }

  async nextCounter(key: string, tx?: DbTx): Promise<number> {
    const counter = await (tx ?? prisma).counter.upsert({
      where: { key },
      create: { key, value: 1 },
      update: { value: { increment: 1 } },
    });
    return counter.value;
  }

  async createWithItems(
    data: QuotationCreateData,
    tx?: DbTx
  ): Promise<{ id: string; quoteNumber: string }> {
    const { items, ...header } = data;
    return (tx ?? prisma).quotation.create({
      data: { ...header, items: { create: items } },
      select: { id: true, quoteNumber: true },
    });
  }

  async updateHeader(
    id: string,
    data: QuotationHeaderUpdateData,
    tx?: DbTx
  ): Promise<void> {
    await (tx ?? prisma).quotation.update({ where: { id }, data });
  }

  async replaceItems(
    quotationId: string,
    ops: {
      create: ItemCreateData[];
      update: { id: string; data: ItemUpdateData }[];
      deleteIds: string[];
    },
    tx?: DbTx
  ): Promise<void> {
    const db = tx ?? prisma;
    if (ops.deleteIds.length > 0) {
      await db.quotationItem.deleteMany({
        where: { id: { in: ops.deleteIds }, quotationId },
      });
    }
    for (const { id, data } of ops.update) {
      await db.quotationItem.update({ where: { id }, data });
    }
    if (ops.create.length > 0) {
      await db.quotationItem.createMany({
        data: ops.create.map((item) => ({ ...item, quotationId })),
      });
    }
  }

  async setStatus(id: string, data: StatusSetData, tx?: DbTx): Promise<void> {
    await (tx ?? prisma).quotation.update({ where: { id }, data });
  }

  async softDelete(id: string, tx?: DbTx): Promise<void> {
    await (tx ?? prisma).quotation.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
