import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { AdjStatus } from "@/generated/prisma/enums";
import type { DbTx } from "@/modules/shared/repositories/types";
import type { AdjustmentListFilters } from "../schemas/stock";

const lineSelect = {
  id: true,
  materialId: true,
  qtyDelta: true,
  unitCost: true,
  reason: true,
  material: { select: { code: true, name: true, unit: true } },
} satisfies Prisma.StockAdjustmentLineSelect;

const listSelect = {
  id: true,
  number: true,
  reason: true,
  status: true,
  requestedAt: true,
  decidedAt: true,
  requestedBy: { select: { name: true } },
  decidedBy: { select: { name: true } },
  lines: { select: { qtyDelta: true } },
} satisfies Prisma.StockAdjustmentSelect;

const detailSelect = {
  id: true,
  number: true,
  reason: true,
  status: true,
  note: true,
  decisionNote: true,
  requestedAt: true,
  decidedAt: true,
  requestedBy: { select: { name: true } },
  decidedBy: { select: { name: true } },
  lines: { select: lineSelect },
} satisfies Prisma.StockAdjustmentSelect;

export type AdjustmentListRecord = Prisma.StockAdjustmentGetPayload<{
  select: typeof listSelect;
}>;
export type AdjustmentDetailRecord = Prisma.StockAdjustmentGetPayload<{
  select: typeof detailSelect;
}>;

export type AdjustmentCreateData = {
  number: string;
  reason: string;
  note: string | null;
  requestedById: string;
  lines: {
    materialId: string;
    qtyDelta: number;
    unitCost: number | string;
    reason: string | null;
  }[];
};

export type AdjustmentDecisionRecord = {
  id: string;
  status: AdjStatus;
  lines: { materialId: string; qtyDelta: number; unitCost: Prisma.Decimal }[];
};

export interface IStockAdjustmentRepository {
  withTransaction<T>(fn: (tx: DbTx) => Promise<T>): Promise<T>;
  numberExists(number: string, tx?: DbTx): Promise<boolean>;
  create(data: AdjustmentCreateData, tx: DbTx): Promise<{ id: string; number: string }>;
  listPage(
    filter: AdjustmentListFilters
  ): Promise<{ rows: AdjustmentListRecord[]; nextCursor: string | null }>;
  findDetail(id: string): Promise<AdjustmentDetailRecord | null>;
  findForDecision(id: string): Promise<AdjustmentDecisionRecord | null>;
  setDecision(
    id: string,
    data: {
      status: AdjStatus;
      decidedById: string;
      decisionNote: string | null;
    },
    tx: DbTx
  ): Promise<void>;
}

export class PrismaStockAdjustmentRepository
  implements IStockAdjustmentRepository
{
  withTransaction<T>(fn: (tx: DbTx) => Promise<T>): Promise<T> {
    return prisma.$transaction(fn);
  }

  async numberExists(number: string, tx?: DbTx): Promise<boolean> {
    const found = await (tx ?? prisma).stockAdjustment.findFirst({
      where: { number: { equals: number, mode: "insensitive" } },
      select: { id: true },
    });
    return !!found;
  }

  async create(
    data: AdjustmentCreateData,
    tx: DbTx
  ): Promise<{ id: string; number: string }> {
    const { lines, ...header } = data;
    return tx.stockAdjustment.create({
      data: { ...header, lines: { create: lines } },
      select: { id: true, number: true },
    });
  }

  async listPage(
    filter: AdjustmentListFilters
  ): Promise<{ rows: AdjustmentListRecord[]; nextCursor: string | null }> {
    const where: Prisma.StockAdjustmentWhereInput = { deletedAt: null };
    if (filter.status) where.status = filter.status;
    if (filter.q) {
      where.OR = [
        { number: { contains: filter.q, mode: "insensitive" } },
        { reason: { contains: filter.q, mode: "insensitive" } },
      ];
    }
    const rows = await prisma.stockAdjustment.findMany({
      where,
      select: listSelect,
      orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
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

  async findDetail(id: string): Promise<AdjustmentDetailRecord | null> {
    return prisma.stockAdjustment.findFirst({
      where: { id, deletedAt: null },
      select: detailSelect,
    });
  }

  async findForDecision(id: string): Promise<AdjustmentDecisionRecord | null> {
    return prisma.stockAdjustment.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        status: true,
        lines: {
          select: { materialId: true, qtyDelta: true, unitCost: true },
        },
      },
    });
  }

  async setDecision(
    id: string,
    data: {
      status: AdjStatus;
      decidedById: string;
      decisionNote: string | null;
    },
    tx: DbTx
  ): Promise<void> {
    await tx.stockAdjustment.update({
      where: { id },
      data: {
        status: data.status,
        decidedById: data.decidedById,
        decidedAt: new Date(),
        decisionNote: data.decisionNote,
      },
    });
  }
}
