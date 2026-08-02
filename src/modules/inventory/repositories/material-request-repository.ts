import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { MrStatus } from "@/generated/prisma/enums";
import type { DbTx } from "@/modules/shared/repositories/types";
import type { MrListFilters } from "../schemas/material-request";

const lineSelect = {
  id: true,
  materialId: true,
  qtyNeeded: true,
  qtyReleased: true,
  systemQtyAtRequest: true,
  unitCostAtRequest: true,
  material: { select: { code: true, name: true, unit: true } },
} satisfies Prisma.MaterialRequestLineSelect;

const listSelect = {
  id: true,
  number: true,
  status: true,
  purpose: true,
  requestedAt: true,
  requestedBy: { select: { name: true } },
  jobOrder: { select: { joNumber: true } },
  lines: {
    select: { qtyNeeded: true, unitCostAtRequest: true },
  },
} satisfies Prisma.MaterialRequestSelect;

const detailSelect = {
  id: true,
  number: true,
  status: true,
  purpose: true,
  requestedAt: true,
  decidedAt: true,
  decisionNote: true,
  lastReleasedAt: true,
  releaseNote: true,
  requestedBy: { select: { name: true } },
  decidedBy: { select: { name: true } },
  releasedBy: { select: { name: true } },
  jobOrder: { select: { id: true, joNumber: true } },
  lines: { select: lineSelect },
} satisfies Prisma.MaterialRequestSelect;

export type MrListRecord = Prisma.MaterialRequestGetPayload<{ select: typeof listSelect }>;
export type MrDetailRecord = Prisma.MaterialRequestGetPayload<{ select: typeof detailSelect }>;

export type MrLineCreate = {
  materialId: string;
  qtyNeeded: number;
  systemQtyAtRequest: number;
  unitCostAtRequest: number | string;
};
export type MrCreateData = {
  number: string;
  jobOrderId: string | null;
  purpose: string | null;
  requestedById: string;
  lines: MrLineCreate[];
};

export type MrDecisionRecord = {
  id: string;
  status: MrStatus;
  lines: { qtyReleased: number }[];
};

export type MrReleaseRecord = {
  id: string;
  status: MrStatus;
  jobOrderId: string | null;
  number: string;
  lines: {
    id: string;
    materialId: string;
    qtyNeeded: number;
    qtyReleased: number;
    unitCostAtRequest: Prisma.Decimal;
    material: { code: string };
  }[];
};

export interface IMaterialRequestRepository {
  withTransaction<T>(fn: (tx: DbTx) => Promise<T>): Promise<T>;
  numberExists(number: string, tx?: DbTx): Promise<boolean>;
  create(data: MrCreateData, tx: DbTx): Promise<{ id: string; number: string }>;
  listPage(filter: MrListFilters): Promise<{ rows: MrListRecord[]; nextCursor: string | null }>;
  findDetail(id: string): Promise<MrDetailRecord | null>;
  findForDecision(id: string): Promise<MrDecisionRecord | null>;
  findForRelease(id: string): Promise<MrReleaseRecord | null>;
  setDecision(id: string, data: { status: MrStatus; decidedById: string; decisionNote: string | null }, tx: DbTx): Promise<void>;
  setStatus(id: string, status: MrStatus, tx: DbTx): Promise<void>;
  addReleased(lineId: string, by: number, tx: DbTx): Promise<void>;
  applyRelease(id: string, data: { status: MrStatus; releasedById: string; releaseNote: string }, tx: DbTx): Promise<void>;
  replaceForEdit(id: string, data: { jobOrderId: string | null; purpose: string | null; lines: MrLineCreate[] }, tx: DbTx): Promise<void>;
  /** Existing MRs on a JO (soft duplicate hint). */
  findByJobOrder(jobOrderId: string): Promise<{ number: string; status: MrStatus }[]>;
  jobOrderExists(id: string): Promise<boolean>;
}

export class PrismaMaterialRequestRepository implements IMaterialRequestRepository {
  withTransaction<T>(fn: (tx: DbTx) => Promise<T>): Promise<T> {
    return prisma.$transaction(fn);
  }

  async numberExists(number: string, tx?: DbTx): Promise<boolean> {
    const found = await (tx ?? prisma).materialRequest.findFirst({
      where: { number: { equals: number, mode: "insensitive" } },
      select: { id: true },
    });
    return !!found;
  }

  async create(data: MrCreateData, tx: DbTx): Promise<{ id: string; number: string }> {
    const { lines, ...header } = data;
    return tx.materialRequest.create({
      data: { ...header, lines: { create: lines } },
      select: { id: true, number: true },
    });
  }

  async listPage(filter: MrListFilters): Promise<{ rows: MrListRecord[]; nextCursor: string | null }> {
    const where: Prisma.MaterialRequestWhereInput = { deletedAt: null };
    if (filter.status) where.status = filter.status;
    if (filter.q) {
      where.OR = [
        { number: { contains: filter.q, mode: "insensitive" } },
        { purpose: { contains: filter.q, mode: "insensitive" } },
        { jobOrder: { joNumber: { contains: filter.q, mode: "insensitive" } } },
      ];
    }
    const rows = await prisma.materialRequest.findMany({
      where,
      select: listSelect,
      orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
      take: filter.take + 1,
      ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > filter.take;
    const page = hasMore ? rows.slice(0, filter.take) : rows;
    return { rows: page, nextCursor: hasMore ? page[page.length - 1]!.id : null };
  }

  async findDetail(id: string): Promise<MrDetailRecord | null> {
    return prisma.materialRequest.findFirst({ where: { id, deletedAt: null }, select: detailSelect });
  }

  async findForDecision(id: string): Promise<MrDecisionRecord | null> {
    return prisma.materialRequest.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, status: true, lines: { select: { qtyReleased: true } } },
    });
  }

  async findForRelease(id: string): Promise<MrReleaseRecord | null> {
    return prisma.materialRequest.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        status: true,
        jobOrderId: true,
        number: true,
        lines: {
          select: {
            id: true,
            materialId: true,
            qtyNeeded: true,
            qtyReleased: true,
            unitCostAtRequest: true,
            material: { select: { code: true } },
          },
        },
      },
    });
  }

  async setDecision(id: string, data: { status: MrStatus; decidedById: string; decisionNote: string | null }, tx: DbTx): Promise<void> {
    await tx.materialRequest.update({
      where: { id },
      data: { status: data.status, decidedById: data.decidedById, decidedAt: new Date(), decisionNote: data.decisionNote },
    });
  }

  async setStatus(id: string, status: MrStatus, tx: DbTx): Promise<void> {
    await tx.materialRequest.update({ where: { id }, data: { status } });
  }

  async addReleased(lineId: string, by: number, tx: DbTx): Promise<void> {
    await tx.materialRequestLine.update({ where: { id: lineId }, data: { qtyReleased: { increment: by } } });
  }

  async applyRelease(id: string, data: { status: MrStatus; releasedById: string; releaseNote: string }, tx: DbTx): Promise<void> {
    await tx.materialRequest.update({
      where: { id },
      data: { status: data.status, releasedById: data.releasedById, lastReleasedAt: new Date(), releaseNote: data.releaseNote },
    });
  }

  async replaceForEdit(id: string, data: { jobOrderId: string | null; purpose: string | null; lines: MrLineCreate[] }, tx: DbTx): Promise<void> {
    await tx.materialRequestLine.deleteMany({ where: { requestId: id } });
    await tx.materialRequest.update({
      where: { id },
      data: {
        jobOrderId: data.jobOrderId,
        purpose: data.purpose,
        status: MrStatus.PENDING,
        decidedById: null,
        decidedAt: null,
        decisionNote: null,
        lines: { create: data.lines },
      },
    });
  }

  async findByJobOrder(jobOrderId: string): Promise<{ number: string; status: MrStatus }[]> {
    return prisma.materialRequest.findMany({
      where: { jobOrderId, deletedAt: null },
      select: { number: true, status: true },
      orderBy: { requestedAt: "desc" },
    });
  }

  async jobOrderExists(id: string): Promise<boolean> {
    const jo = await prisma.jobOrder.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    return !!jo;
  }
}
