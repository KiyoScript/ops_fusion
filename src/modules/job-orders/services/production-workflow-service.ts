import { type Actor } from "@/lib/authz";
import { assertCan } from "@/lib/ability";
import type { DbTx } from "@/modules/shared/repositories/types";
import type { IActivityLogRepository } from "@/modules/shared/repositories/activity-log-repository";
import { PrismaActivityLogRepository } from "@/modules/shared/repositories/activity-log-repository";
import type { IProductionWorkflowRepository } from "../repositories/production-workflow-repository";
import { PrismaProductionWorkflowRepository } from "../repositories/production-workflow-repository";

/** The standardized production workflow (ruling 2026-08-12 — a fixed standard:
 *  LFP items get Layout → Plotting → Printing; all applicable items get Capture
 *  (per-JO toggle) → DR). Replaces the editable GlobalProductionStep list. */
export class ProductionWorkflowService {
  constructor(
    private readonly repo: IProductionWorkflowRepository,
    private readonly activity: IActivityLogRepository
  ) {}

  /** Seed the standardized production workflow onto a new JO's items that have
   *  no steps yet. Internal — called right after a JO is created (quote
   *  conversion or direct entry). Returns the number of items seeded. */
  async applyStandardWorkflow(jobOrderId: string, tx?: DbTx): Promise<number> {
    return this.repo.seedForJobOrder(jobOrderId, tx);
  }

  /** Flip the per-JO Capture toggle and add/remove the Capture step on each
   *  item (inserted before DR; removed only when not yet done). */
  async setNeedsCapture(
    actor: Actor,
    jobOrderId: string,
    value: boolean
  ): Promise<void> {
    assertCan(actor, "update", "JobOrder");
    await this.repo.setNeedsCapture(jobOrderId, value);
    await this.activity.log({
      userId: actor.id,
      entityType: "JobOrder",
      entityId: jobOrderId,
      action: "update",
      payload: { needsCapture: value },
    });
  }
}

let instance: ProductionWorkflowService | undefined;

export function getProductionWorkflowService(): ProductionWorkflowService {
  instance ??= new ProductionWorkflowService(
    new PrismaProductionWorkflowRepository(),
    new PrismaActivityLogRepository()
  );
  return instance;
}
