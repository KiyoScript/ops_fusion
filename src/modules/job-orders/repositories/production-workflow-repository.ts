import { prisma } from "@/lib/prisma";
import type { DbTx } from "@/modules/shared/repositories/types";
import {
  CAPTURE_STEP,
  DR_STEP,
  standardWorkflowSteps,
} from "../production-steps";

export interface IProductionWorkflowRepository {
  /** Seed the standardized production workflow onto every item of a JO that
   *  has NO steps yet. LFP items get Layout → Plotting → Printing; all
   *  applicable items get Capture (when the JO opts in) → DR. Returns the
   *  number of items seeded. Called right after a JO is created. */
  seedForJobOrder(jobOrderId: string, tx?: DbTx): Promise<number>;
  /** Flip the JO's Capture toggle and add/remove the Capture step on each item
   *  (inserted just before DR; removed only when not yet done). */
  setNeedsCapture(
    jobOrderId: string,
    value: boolean,
    tx?: DbTx
  ): Promise<void>;
}

export class PrismaProductionWorkflowRepository
  implements IProductionWorkflowRepository
{
  async seedForJobOrder(jobOrderId: string, tx?: DbTx): Promise<number> {
    const db = tx ?? prisma;
    const jo = await db.jobOrder.findUnique({
      where: { id: jobOrderId },
      select: { needsCapture: true },
    });
    if (!jo) return 0;
    // Each item's steps follow the fixed standard, keyed on the item's LFP flag
    // (from its product) and the JO's Capture toggle.
    const items = await db.jobOrderItem.findMany({
      where: { jobOrderId, steps: { none: {} } },
      select: { id: true, isLFP: true },
    });
    if (items.length === 0) return 0;
    await db.jobOrderItemStep.createMany({
      data: items.flatMap((it) =>
        standardWorkflowSteps(it.isLFP, jo.needsCapture).map((name, i) => ({
          jobOrderItemId: it.id,
          name,
          sortOrder: i,
        }))
      ),
    });
    return items.length;
  }

  async setNeedsCapture(
    jobOrderId: string,
    value: boolean,
    tx?: DbTx
  ): Promise<void> {
    const db = tx ?? prisma;
    await db.jobOrder.update({
      where: { id: jobOrderId },
      data: { needsCapture: value },
    });
    const items = await db.jobOrderItem.findMany({
      where: { jobOrderId },
      select: {
        id: true,
        steps: {
          select: { id: true, name: true, sortOrder: true, doneAt: true },
          orderBy: { sortOrder: "asc" },
        },
      },
    });
    for (const it of items) {
      const capture = it.steps.find((s) => s.name === CAPTURE_STEP);
      const dr = it.steps.find((s) => s.name === DR_STEP);
      if (value && !capture && dr) {
        // Insert Capture immediately before DR (shift DR and anything after up).
        await db.jobOrderItemStep.updateMany({
          where: { jobOrderItemId: it.id, sortOrder: { gte: dr.sortOrder } },
          data: { sortOrder: { increment: 1 } },
        });
        await db.jobOrderItemStep.create({
          data: {
            jobOrderItemId: it.id,
            name: CAPTURE_STEP,
            sortOrder: dr.sortOrder,
          },
        });
      } else if (!value && capture && !capture.doneAt) {
        // Drop an un-done Capture step and close the gap.
        await db.jobOrderItemStep.delete({ where: { id: capture.id } });
        await db.jobOrderItemStep.updateMany({
          where: {
            jobOrderItemId: it.id,
            sortOrder: { gt: capture.sortOrder },
          },
          data: { sortOrder: { decrement: 1 } },
        });
      }
    }
  }
}
