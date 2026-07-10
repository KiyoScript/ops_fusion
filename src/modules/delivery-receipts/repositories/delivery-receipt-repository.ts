import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { JobOrderStatus, DeliveryReceiptStatus } from "@/generated/prisma/enums";
import type { DbTx } from "@/modules/shared/repositories/types";

// ——— selection shapes ———

const deliverableItemSelect = {
  id: true,
  description: true,
  qty: true,
  qtyDelivered: true,
  unitPrice: true,
  lineTotal: true,
  lineItemId: true,
  jobOrder: {
    select: {
      id: true,
      joNumber: true,
      completedAt: true,
      customer: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.JobOrderItemSelect;

const drListSelect = {
  id: true,
  drNumber: true,
  status: true,
  issuedAt: true,
  jobOrder: { select: { joNumber: true } },
  customer: { select: { name: true } },
  lines: {
    select: { qty: true, jobOrderItem: { select: { unitPrice: true } } },
  },
} satisfies Prisma.DeliveryReceiptSelect;

const drDetailSelect = {
  id: true,
  drNumber: true,
  status: true,
  issuedAt: true,
  notes: true,
  createdBy: { select: { name: true } },
  jobOrder: { select: { id: true, joNumber: true } },
  customer: { select: { id: true, name: true } },
  lines: {
    select: {
      id: true,
      qty: true,
      jobOrderItem: {
        select: {
          description: true,
          lineItemId: true,
          unitPrice: true,
        },
      },
    },
  },
} satisfies Prisma.DeliveryReceiptSelect;

export type DeliverableItemRecord = Prisma.JobOrderItemGetPayload<{
  select: typeof deliverableItemSelect;
}>;
export type DrListRecord = Prisma.DeliveryReceiptGetPayload<{
  select: typeof drListSelect;
}>;
export type DrDetailRecord = Prisma.DeliveryReceiptGetPayload<{
  select: typeof drDetailSelect;
}>;

export type DrLineCreate = { jobOrderItemId: string; qty: number };
export type DrCreateData = {
  drNumber: string;
  jobOrderId: string;
  customerId: string;
  notes?: string | null;
  createdById: string;
  lines: DrLineCreate[];
};

export type DrListFilter = { q?: string; cursor?: string; take: number };

export interface IDeliveryReceiptRepository {
  withTransaction<T>(fn: (tx: DbTx) => Promise<T>): Promise<T>;
  /** Done items (production finished) of non-cancelled JOs — the service
   *  drops any whose quantity is already fully delivered. With `jobOrderId`,
   *  returns every item of that JO; otherwise a recent, optionally
   *  search-filtered slice for the issue picker. */
  listDeliverableItems(opts?: {
    jobOrderId?: string;
    q?: string;
  }): Promise<DeliverableItemRecord[]>;
  drNumberExists(drNumber: string, tx?: DbTx): Promise<boolean>;
  nextCounter(key: string, tx: DbTx): Promise<number>;
  createDr(
    data: DrCreateData,
    tx: DbTx
  ): Promise<{ id: string; drNumber: string }>;
  incrementDelivered(itemId: string, by: number, tx: DbTx): Promise<void>;
  listPage(
    filter: DrListFilter
  ): Promise<{ rows: DrListRecord[]; nextCursor: string | null }>;
  findDetail(id: string): Promise<DrDetailRecord | null>;
  getLinesForCancel(
    id: string
  ): Promise<{ status: DeliveryReceiptStatus; lines: DrLineCreate[] } | null>;
  setCancelled(id: string, tx: DbTx): Promise<void>;
}

export class PrismaDeliveryReceiptRepository
  implements IDeliveryReceiptRepository
{
  withTransaction<T>(fn: (tx: DbTx) => Promise<T>): Promise<T> {
    return prisma.$transaction(fn);
  }

  async listDeliverableItems(
    opts: { jobOrderId?: string; q?: string } = {}
  ): Promise<DeliverableItemRecord[]> {
    const { jobOrderId, q } = opts;
    const joWhere: Prisma.JobOrderWhereInput = {
      deletedAt: null,
      status: { not: JobOrderStatus.CANCELLED },
      ...(jobOrderId ? { id: jobOrderId } : {}),
    };
    if (q) {
      joWhere.OR = [
        { joNumber: { contains: q, mode: "insensitive" } },
        { customer: { name: { contains: q, mode: "insensitive" } } },
      ];
    }
    return prisma.jobOrderItem.findMany({
      where: { archivedAt: { not: null }, jobOrder: joWhere }, // done / finished
      select: deliverableItemSelect,
      // A specific JO → all its items in order; the picker → most-recently
      // finished first, capped so the search stays fast.
      orderBy: jobOrderId
        ? [{ sortOrder: "asc" }]
        : [{ archivedAt: "desc" }, { id: "desc" }],
      ...(jobOrderId ? {} : { take: 400 }),
    });
  }

  async drNumberExists(drNumber: string, tx?: DbTx): Promise<boolean> {
    const found = await (tx ?? prisma).deliveryReceipt.findFirst({
      where: { drNumber: { equals: drNumber, mode: "insensitive" } },
      select: { id: true },
    });
    return !!found;
  }

  async nextCounter(key: string, tx: DbTx): Promise<number> {
    const counter = await tx.counter.upsert({
      where: { key },
      create: { key, value: 1 },
      update: { value: { increment: 1 } },
    });
    return counter.value;
  }

  async createDr(
    data: DrCreateData,
    tx: DbTx
  ): Promise<{ id: string; drNumber: string }> {
    const { lines, ...header } = data;
    return tx.deliveryReceipt.create({
      data: { ...header, lines: { create: lines } },
      select: { id: true, drNumber: true },
    });
  }

  async incrementDelivered(
    itemId: string,
    by: number,
    tx: DbTx
  ): Promise<void> {
    await tx.jobOrderItem.update({
      where: { id: itemId },
      data: { qtyDelivered: { increment: by } },
    });
  }

  async listPage(
    filter: DrListFilter
  ): Promise<{ rows: DrListRecord[]; nextCursor: string | null }> {
    const where: Prisma.DeliveryReceiptWhereInput = { deletedAt: null };
    if (filter.q) {
      where.OR = [
        { drNumber: { contains: filter.q, mode: "insensitive" } },
        { jobOrder: { joNumber: { contains: filter.q, mode: "insensitive" } } },
        { customer: { name: { contains: filter.q, mode: "insensitive" } } },
      ];
    }
    const rows = await prisma.deliveryReceipt.findMany({
      where,
      select: drListSelect,
      orderBy: [{ issuedAt: "desc" }, { id: "desc" }],
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

  async findDetail(id: string): Promise<DrDetailRecord | null> {
    return prisma.deliveryReceipt.findFirst({
      where: { id, deletedAt: null },
      select: drDetailSelect,
    });
  }

  async getLinesForCancel(
    id: string
  ): Promise<{ status: DeliveryReceiptStatus; lines: DrLineCreate[] } | null> {
    const dr = await prisma.deliveryReceipt.findFirst({
      where: { id, deletedAt: null },
      select: {
        status: true,
        lines: { select: { jobOrderItemId: true, qty: true } },
      },
    });
    return dr ?? null;
  }

  async setCancelled(id: string, tx: DbTx): Promise<void> {
    await tx.deliveryReceipt.update({
      where: { id },
      data: { status: DeliveryReceiptStatus.CANCELLED },
    });
  }
}
