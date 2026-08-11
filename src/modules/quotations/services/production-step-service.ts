import { type Actor } from "@/lib/authz";
import { assertCan } from "@/lib/ability";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
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

  /** Backfill: copy the product's CURRENT workflow onto one JO item that has
   *  none yet (items created/converted before the template was defined).
   *  Explicit user action — never applied silently to jobs in production. */
  async applyTemplateToItem(
    actor: Actor,
    jobOrderItemId: string
  ): Promise<number> {
    assertCan(actor, "update", "JobOrderItem");
    const item = await this.steps.getItemForSeeding(jobOrderItemId);
    if (!item) throw new NotFoundError("JO item not found.");
    if (item.existingSteps > 0) {
      throw new ConflictError("This item already has production steps.");
    }
    // The item's product template if it has one; otherwise the GLOBAL workflow
    // (so items with no product-specific flow still get the shop's default).
    let steps = item.productId
      ? await this.steps.listForProduct(item.productId)
      : [];
    if (steps.length === 0) steps = await this.steps.listGlobalSteps();
    if (steps.length === 0) {
      throw new ValidationError(
        "No workflow to apply — set the product's steps or the global workflow in JO Maintenance → Production workflow first."
      );
    }
    await this.steps.seedItemSteps(jobOrderItemId, steps);
    await this.activity.log({
      userId: actor.id,
      entityType: "JobOrderItem",
      entityId: jobOrderItemId,
      action: "steps-applied",
      payload: { count: steps.length },
    });
    return steps.length;
  }

  /** Mark a JO item's production step done/undone. Uses the JO-item update
   *  permission (operators advance production). */
  async setStepDone(
    actor: Actor,
    stepId: string,
    done: boolean
  ): Promise<void> {
    assertCan(actor, "update", "JobOrderItem");

    // Steps are SEQUENTIAL — a step can only be completed once every earlier
    // step is done, and can only be re-opened while every later step is still
    // open. Prevents "last step done while middle steps pending".
    const ctx = await this.steps.getStepOrderContext(stepId);
    if (!ctx) throw new NotFoundError("Production step not found.");
    if (done) {
      const earlierPending = ctx.siblings.some(
        (s) => s.sortOrder < ctx.sortOrder && !s.done
      );
      if (earlierPending) {
        throw new ValidationError(
          "Finish the earlier steps first — production steps are done in order."
        );
      }
    } else {
      const laterDone = ctx.siblings.some(
        (s) => s.sortOrder > ctx.sortOrder && s.done
      );
      if (laterDone) {
        throw new ValidationError(
          "Undo the later steps first — production steps are done in order."
        );
      }
    }

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
