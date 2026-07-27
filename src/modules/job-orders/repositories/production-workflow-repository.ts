import { prisma } from "@/lib/prisma";
import type { DbTx } from "@/modules/shared/repositories/types";

export type GlobalStepRecord = {
  id: string;
  name: string;
  rankFromEnd: number;
  isActive: boolean;
};

const select = { id: true, name: true, rankFromEnd: true, isActive: true } as const;

export interface IProductionWorkflowRepository {
  list(includeInactive: boolean): Promise<GlobalStepRecord[]>;
  findById(id: string): Promise<GlobalStepRecord | null>;
  create(data: { name: string; rankFromEnd: number }): Promise<GlobalStepRecord>;
  update(
    id: string,
    data: { name?: string; rankFromEnd?: number; isActive?: boolean }
  ): Promise<void>;
  delete(id: string): Promise<void>;
  /** Seed the active global workflow onto every item of a JO that has NO steps
   *  yet (per-product templates already seeded take precedence). Returns the
   *  number of items seeded. Called right after a JO is created. */
  seedForJobOrder(jobOrderId: string, tx?: DbTx): Promise<number>;
}

export class PrismaProductionWorkflowRepository
  implements IProductionWorkflowRepository
{
  async list(includeInactive: boolean): Promise<GlobalStepRecord[]> {
    return prisma.globalProductionStep.findMany({
      where: includeInactive ? {} : { isActive: true },
      // Workflow order: highest rank first, rank 1 (the last step) last.
      orderBy: [{ rankFromEnd: "desc" }, { name: "asc" }],
      select,
    });
  }

  async findById(id: string): Promise<GlobalStepRecord | null> {
    return prisma.globalProductionStep.findUnique({ where: { id }, select });
  }

  async create(data: { name: string; rankFromEnd: number }): Promise<GlobalStepRecord> {
    return prisma.globalProductionStep.create({ data, select });
  }

  async update(
    id: string,
    data: { name?: string; rankFromEnd?: number; isActive?: boolean }
  ): Promise<void> {
    await prisma.globalProductionStep.update({ where: { id }, data });
  }

  async delete(id: string): Promise<void> {
    await prisma.globalProductionStep.delete({ where: { id } });
  }

  async seedForJobOrder(jobOrderId: string, tx?: DbTx): Promise<number> {
    const db = tx ?? prisma;
    const global = await db.globalProductionStep.findMany({
      where: { isActive: true },
      // Workflow order (first → last): rankFromEnd DESC, so sortOrder 0 = first.
      orderBy: [{ rankFromEnd: "desc" }, { name: "asc" }],
      select: { name: true },
    });
    if (global.length === 0) return 0;
    const items = await db.jobOrderItem.findMany({
      where: { jobOrderId, steps: { none: {} } },
      select: { id: true },
    });
    if (items.length === 0) return 0;
    await db.jobOrderItemStep.createMany({
      data: items.flatMap((it) =>
        global.map((s, i) => ({ jobOrderItemId: it.id, name: s.name, sortOrder: i }))
      ),
    });
    return items.length;
  }
}
