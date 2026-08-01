import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { CountStatus } from "@/generated/prisma/enums";
import type { DbTx } from "@/modules/shared/repositories/types";
import type { CycleCountListFilters } from "../schemas/stock";

const lineSelect = {
  id: true,
  materialId: true,
  systemQty: true,
  countedQty: true,
  unitCost: true,
  material: { select: { code: true, name: true, unit: true } },
} satisfies Prisma.CycleCountLineSelect;

const listSelect = {
  id: true,
  number: true,
  status: true,
  location: true,
  countedAt: true,
  approvedAt: true,
  countedBy: { select: { name: true } },
  approvedBy: { select: { name: true } },
  lines: { select: { systemQty: true, countedQty: true } },
} satisfies Prisma.CycleCountSelect;

const detailSelect = {
  id: true,
  number: true,
  status: true,
  location: true,
  note: true,
  countedAt: true,
  approvedAt: true,
  countedBy: { select: { name: true } },
  approvedBy: { select: { name: true } },
  lines: { select: lineSelect },
} satisfies Prisma.CycleCountSelect;

export type CycleCountListRecord = Prisma.CycleCountGetPayload<{
  select: typeof listSelect;
}>;
export type CycleCountDetailRecord = Prisma.CycleCountGetPayload<{
  select: typeof detailSelect;
}>;

export type CountLineData = {
  materialId: string;
  systemQty: number;
  countedQty: number;
  unitCost: number | string;
};

export type CycleCountCreateData = {
  number: string;
  location: string | null;
  note: string | null;
  countedById: string;
  lines: CountLineData[];
};

export type CycleCountApprovalRecord = {
  id: string;
  status: CountStatus;
  lines: { materialId: string; countedQty: number; unitCost: Prisma.Decimal }[];
};

export interface ICycleCountRepository {
  withTransaction<T>(fn: (tx: DbTx) => Promise<T>): Promise<T>;
  numberExists(number: string, tx?: DbTx): Promise<boolean>;
  create(data: CycleCountCreateData, tx: DbTx): Promise<{ id: string; number: string }>;
  findStatus(id: string): Promise<{ status: CountStatus } | null>;
  updateHeader(
    id: string,
    data: { location: string | null; note: string | null },
    tx: DbTx
  ): Promise<void>;
  replaceLines(id: string, lines: CountLineData[], tx: DbTx): Promise<void>;
  listPage(
    filter: CycleCountListFilters
  ): Promise<{ rows: CycleCountListRecord[]; nextCursor: string | null }>;
  findDetail(id: string): Promise<CycleCountDetailRecord | null>;
  findForApproval(id: string): Promise<CycleCountApprovalRecord | null>;
  setStatus(
    id: string,
    data: { status: CountStatus; approvedById?: string; approvedAt?: Date },
    tx: DbTx
  ): Promise<void>;
}

export class PrismaCycleCountRepository implements ICycleCountRepository {
  withTransaction<T>(fn: (tx: DbTx) => Promise<T>): Promise<T> {
    return prisma.$transaction(fn);
  }

  async numberExists(number: string, tx?: DbTx): Promise<boolean> {
    const found = await (tx ?? prisma).cycleCount.findFirst({
      where: { number: { equals: number, mode: "insensitive" } },
      select: { id: true },
    });
    return !!found;
  }

  async create(
    data: CycleCountCreateData,
    tx: DbTx
  ): Promise<{ id: string; number: string }> {
    const { lines, ...header } = data;
    return tx.cycleCount.create({
      data: { ...header, lines: { create: lines } },
      select: { id: true, number: true },
    });
  }

  async findStatus(id: string): Promise<{ status: CountStatus } | null> {
    return prisma.cycleCount.findFirst({
      where: { id, deletedAt: null },
      select: { status: true },
    });
  }

  async updateHeader(
    id: string,
    data: { location: string | null; note: string | null },
    tx: DbTx
  ): Promise<void> {
    await tx.cycleCount.update({ where: { id }, data });
  }

  async replaceLines(
    id: string,
    lines: CountLineData[],
    tx: DbTx
  ): Promise<void> {
    await tx.cycleCountLine.deleteMany({ where: { cycleCountId: id } });
    if (lines.length > 0) {
      await tx.cycleCountLine.createMany({
        data: lines.map((l) => ({ ...l, cycleCountId: id })),
      });
    }
  }

  async listPage(
    filter: CycleCountListFilters
  ): Promise<{ rows: CycleCountListRecord[]; nextCursor: string | null }> {
    const where: Prisma.CycleCountWhereInput = { deletedAt: null };
    if (filter.status) where.status = filter.status;
    if (filter.q) {
      where.OR = [
        { number: { contains: filter.q, mode: "insensitive" } },
        { location: { contains: filter.q, mode: "insensitive" } },
      ];
    }
    const rows = await prisma.cycleCount.findMany({
      where,
      select: listSelect,
      orderBy: [{ countedAt: "desc" }, { id: "desc" }],
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

  async findDetail(id: string): Promise<CycleCountDetailRecord | null> {
    return prisma.cycleCount.findFirst({
      where: { id, deletedAt: null },
      select: detailSelect,
    });
  }

  async findForApproval(id: string): Promise<CycleCountApprovalRecord | null> {
    return prisma.cycleCount.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        status: true,
        lines: {
          select: { materialId: true, countedQty: true, unitCost: true },
        },
      },
    });
  }

  async setStatus(
    id: string,
    data: { status: CountStatus; approvedById?: string; approvedAt?: Date },
    tx: DbTx
  ): Promise<void> {
    await tx.cycleCount.update({
      where: { id },
      data: {
        status: data.status,
        ...(data.approvedById ? { approvedById: data.approvedById } : {}),
        ...(data.approvedAt ? { approvedAt: data.approvedAt } : {}),
      },
    });
  }
}
