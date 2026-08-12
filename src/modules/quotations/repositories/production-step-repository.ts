import { prisma } from "@/lib/prisma";
import type { DbTx } from "@/modules/shared/repositories/types";

export type ProductionStepRecord = {
  id: string;
  name: string;
  sortOrder: number;
};

export interface IProductionStepRepository {
  /** Active steps of a product, in order — the workflow template. */
  listForProduct(productId: string, tx?: DbTx): Promise<ProductionStepRecord[]>;
  /** Replace a product's whole step template (Maintenance save). */
  replaceForProduct(
    productId: string,
    names: string[],
    tx?: DbTx
  ): Promise<void>;
  /** What the standard-workflow backfill needs to know about an item. */
  getItemForSeeding(jobOrderItemId: string): Promise<{
    productId: string | null;
    existingSteps: number;
    isLFP: boolean;
    needsCapture: boolean;
  } | null>;
  /** Copy a set of steps onto a JO item (backfill). */
  seedItemSteps(
    jobOrderItemId: string,
    steps: ProductionStepRecord[],
    tx?: DbTx
  ): Promise<void>;
  /** The tracked steps of one JO item, in order. */
  listItemSteps(jobOrderItemId: string): Promise<ItemStepRecord[]>;
  /** Toggle a step done/undone (records who + when). */
  setStepDone(
    stepId: string,
    done: boolean,
    userId: string
  ): Promise<{ jobOrderItemId: string }>;
  /** The step's position + its siblings' done state, for the sequential guard. */
  getStepOrderContext(stepId: string): Promise<{
    jobOrderItemId: string;
    sortOrder: number;
    siblings: { sortOrder: number; done: boolean }[];
  } | null>;
}

export type ItemStepRecord = {
  id: string;
  name: string;
  sortOrder: number;
  doneAt: string | null;
  doneByName: string | null;
};

export class PrismaProductionStepRepository
  implements IProductionStepRepository
{
  async listForProduct(
    productId: string,
    tx?: DbTx
  ): Promise<ProductionStepRecord[]> {
    return (tx ?? prisma).productionStep.findMany({
      where: { productId, isActive: true },
      select: { id: true, name: true, sortOrder: true },
      orderBy: { sortOrder: "asc" },
    });
  }

  async replaceForProduct(
    productId: string,
    names: string[],
    tx?: DbTx
  ): Promise<void> {
    const db = tx ?? prisma;
    await db.productionStep.deleteMany({ where: { productId } });
    if (names.length > 0) {
      await db.productionStep.createMany({
        data: names.map((name, i) => ({ productId, name, sortOrder: i })),
      });
    }
  }

  /** What the standard-workflow backfill needs to know about an item. */
  async getItemForSeeding(jobOrderItemId: string): Promise<{
    productId: string | null;
    existingSteps: number;
    isLFP: boolean;
    needsCapture: boolean;
  } | null> {
    const item = await prisma.jobOrderItem.findUnique({
      where: { id: jobOrderItemId },
      select: {
        productId: true,
        isLFP: true,
        _count: { select: { steps: true } },
        jobOrder: { select: { needsCapture: true } },
      },
    });
    return item
      ? {
          productId: item.productId,
          existingSteps: item._count.steps,
          isLFP: item.isLFP,
          needsCapture: item.jobOrder.needsCapture,
        }
      : null;
  }

  async seedItemSteps(
    jobOrderItemId: string,
    steps: ProductionStepRecord[],
    tx?: DbTx
  ): Promise<void> {
    if (steps.length === 0) return;
    await (tx ?? prisma).jobOrderItemStep.createMany({
      data: steps.map((s) => ({
        jobOrderItemId,
        name: s.name,
        sortOrder: s.sortOrder,
      })),
    });
  }

  async listItemSteps(jobOrderItemId: string): Promise<ItemStepRecord[]> {
    const rows = await prisma.jobOrderItemStep.findMany({
      where: { jobOrderItemId },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        name: true,
        sortOrder: true,
        doneAt: true,
        doneBy: { select: { name: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      sortOrder: r.sortOrder,
      doneAt: r.doneAt?.toISOString() ?? null,
      doneByName: r.doneBy?.name ?? null,
    }));
  }

  async setStepDone(
    stepId: string,
    done: boolean,
    userId: string
  ): Promise<{ jobOrderItemId: string }> {
    const updated = await prisma.jobOrderItemStep.update({
      where: { id: stepId },
      data: done
        ? { doneAt: new Date(), doneById: userId }
        : { doneAt: null, doneById: null },
      select: { jobOrderItemId: true },
    });
    return updated;
  }

  async getStepOrderContext(stepId: string): Promise<{
    jobOrderItemId: string;
    sortOrder: number;
    siblings: { sortOrder: number; done: boolean }[];
  } | null> {
    const step = await prisma.jobOrderItemStep.findUnique({
      where: { id: stepId },
      select: { jobOrderItemId: true, sortOrder: true },
    });
    if (!step) return null;
    const siblings = await prisma.jobOrderItemStep.findMany({
      where: { jobOrderItemId: step.jobOrderItemId },
      select: { sortOrder: true, doneAt: true },
      orderBy: { sortOrder: "asc" },
    });
    return {
      jobOrderItemId: step.jobOrderItemId,
      sortOrder: step.sortOrder,
      siblings: siblings.map((s) => ({ sortOrder: s.sortOrder, done: s.doneAt !== null })),
    };
  }
}
