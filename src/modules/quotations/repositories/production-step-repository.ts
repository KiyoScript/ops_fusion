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
  /** The single GLOBAL production workflow — the fallback used when a product
   *  has no per-product template of its own (ruling 2026-07-24). */
  listGlobalSteps(tx?: DbTx): Promise<ProductionStepRecord[]>;
  /** Replace a product's whole step template (Maintenance save). */
  replaceForProduct(
    productId: string,
    names: string[],
    tx?: DbTx
  ): Promise<void>;
  /** What the backfill needs to know about an item before seeding. */
  getItemForSeeding(jobOrderItemId: string): Promise<{
    productId: string | null;
    existingSteps: number;
  } | null>;
  /** Copy a product's template onto a JO item at creation. */
  seedItemSteps(
    jobOrderItemId: string,
    steps: ProductionStepRecord[],
    tx?: DbTx
  ): Promise<void>;
  /** For every item of a JO with a product that has a step template, copy
   *  that template onto the item. Called right after a JO is created. */
  seedStepsForJobOrder(jobOrderId: string, tx?: DbTx): Promise<number>;
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

  async listGlobalSteps(tx?: DbTx): Promise<ProductionStepRecord[]> {
    // Workflow order = rankFromEnd DESC (rank 1 = the last step). Re-indexed to
    // a plain sortOrder so it copies onto JO items like a product template.
    const rows = await (tx ?? prisma).globalProductionStep.findMany({
      where: { isActive: true },
      orderBy: [{ rankFromEnd: "desc" }, { name: "asc" }],
      select: { name: true },
    });
    return rows.map((r, i) => ({ id: "", name: r.name, sortOrder: i }));
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

  /** What the backfill needs to know about an item before seeding. */
  async getItemForSeeding(jobOrderItemId: string): Promise<{
    productId: string | null;
    existingSteps: number;
  } | null> {
    const item = await prisma.jobOrderItem.findUnique({
      where: { id: jobOrderItemId },
      select: { productId: true, _count: { select: { steps: true } } },
    });
    return item
      ? { productId: item.productId, existingSteps: item._count.steps }
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

  async seedStepsForJobOrder(jobOrderId: string, tx?: DbTx): Promise<number> {
    const db = tx ?? prisma;
    // ALL items (not just product-linked) — an item whose product has no
    // template of its own falls back to the global workflow.
    const items = await db.jobOrderItem.findMany({
      where: { jobOrderId },
      select: { id: true, productId: true },
    });
    const global = await this.listGlobalSteps(tx);
    const templates = new Map<string, ProductionStepRecord[]>();
    let seeded = 0;
    for (const item of items) {
      let steps: ProductionStepRecord[] = [];
      if (item.productId) {
        steps =
          templates.get(item.productId) ??
          (await this.listForProduct(item.productId, tx));
        templates.set(item.productId, steps);
      }
      if (steps.length === 0) steps = global; // fall back to the global workflow
      if (steps.length > 0) {
        await this.seedItemSteps(item.id, steps, tx);
        seeded++;
      }
    }
    return seeded;
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
