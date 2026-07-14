import { type Actor } from "@/lib/authz";
import { assertCan } from "@/lib/ability";
import type { IActivityLogRepository } from "@/modules/shared/repositories/activity-log-repository";
import type {
  IProductionStepRepository,
  ItemStepRecord,
  ProductionStepRecord,
} from "../repositories/production-step-repository";
import type { ProductionStepsSaveInput } from "../schemas/price-list";

// Per-product production workflow — the ordered steps a JO item of the
// product moves through. Edited in Quotation Maintenance; the template is
// copied onto JO items at creation (production-step-repository.seedItemSteps).
export class ProductionStepService {
  constructor(
    private readonly steps: IProductionStepRepository,
    private readonly activity: IActivityLogRepository
  ) {}

  async list(_actor: Actor, productId: string): Promise<ProductionStepRecord[]> {
    return this.steps.listForProduct(productId);
  }

  async save(actor: Actor, input: ProductionStepsSaveInput): Promise<void> {
    assertCan(actor, "maintain", "Maintenance");
    const names = input.steps.map((s) => s.trim()).filter(Boolean);
    await this.steps.replaceForProduct(input.productId, names);
    await this.activity.log({
      userId: actor.id,
      entityType: "Product",
      entityId: input.productId,
      action: "production-steps",
      payload: { count: names.length },
    });
  }

  /** Production tracking — the steps of one JO item (any authed role reads). */
  async listItemSteps(
    _actor: Actor,
    jobOrderItemId: string
  ): Promise<ItemStepRecord[]> {
    return this.steps.listItemSteps(jobOrderItemId);
  }

  /** Mark a JO item's production step done/undone. Uses the JO-item update
   *  permission (operators advance production). */
  async setStepDone(
    actor: Actor,
    stepId: string,
    done: boolean
  ): Promise<void> {
    assertCan(actor, "update", "JobOrderItem");
    const { jobOrderItemId } = await this.steps.setStepDone(
      stepId,
      done,
      actor.id
    );
    await this.activity.log({
      userId: actor.id,
      entityType: "JobOrderItem",
      entityId: jobOrderItemId,
      action: done ? "step-done" : "step-undone",
      payload: { stepId },
    });
  }
}
