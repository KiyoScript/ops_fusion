import { NotFoundError } from "@/lib/errors";
import { type Actor } from "@/lib/authz";
import { assertCan } from "@/lib/ability";
import type { DbTx } from "@/modules/shared/repositories/types";
import type { IActivityLogRepository } from "@/modules/shared/repositories/activity-log-repository";
import { PrismaActivityLogRepository } from "@/modules/shared/repositories/activity-log-repository";
import type { IProductionWorkflowRepository } from "../repositories/production-workflow-repository";
import { PrismaProductionWorkflowRepository } from "../repositories/production-workflow-repository";
import type {
  GlobalStepCreateInput,
  GlobalStepDto,
  GlobalStepUpdateInput,
} from "../schemas/production-workflow";

/** The single global production workflow (ruling 2026-07-24 — replaces the
 *  per-product ProductionStep templates). Maintained in JO Maintenance. */
export class ProductionWorkflowService {
  constructor(
    private readonly repo: IProductionWorkflowRepository,
    private readonly activity: IActivityLogRepository
  ) {}

  async list(_actor: Actor, includeInactive = false): Promise<GlobalStepDto[]> {
    return this.repo.list(includeInactive);
  }

  /** Backfill the global workflow onto a new JO's items that have no steps yet
   *  (per-product templates take precedence). Internal — called right after a
   *  JO is created (quote conversion or direct entry). Returns items seeded. */
  async applyGlobalToJobOrder(jobOrderId: string, tx?: DbTx): Promise<number> {
    return this.repo.seedForJobOrder(jobOrderId, tx);
  }

  async create(actor: Actor, input: GlobalStepCreateInput): Promise<GlobalStepDto> {
    assertCan(actor, "maintain", "Maintenance");
    const created = await this.repo.create({
      name: input.name,
      rankFromEnd: input.rankFromEnd,
    });
    await this.activity.log({
      userId: actor.id,
      entityType: "GlobalProductionStep",
      entityId: created.id,
      action: "create",
      payload: { name: created.name, rankFromEnd: created.rankFromEnd },
    });
    return created;
  }

  async update(actor: Actor, input: GlobalStepUpdateInput): Promise<void> {
    assertCan(actor, "maintain", "Maintenance");
    const existing = await this.repo.findById(input.id);
    if (!existing) throw new NotFoundError("Production step not found.");
    await this.repo.update(input.id, {
      name: input.name,
      rankFromEnd: input.rankFromEnd,
      isActive: input.isActive,
    });
    await this.activity.log({
      userId: actor.id,
      entityType: "GlobalProductionStep",
      entityId: input.id,
      action: "update",
      payload: { name: input.name ?? existing.name },
    });
  }

  async remove(actor: Actor, id: string): Promise<void> {
    assertCan(actor, "maintain", "Maintenance");
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundError("Production step not found.");
    await this.repo.delete(id);
    await this.activity.log({
      userId: actor.id,
      entityType: "GlobalProductionStep",
      entityId: id,
      action: "delete",
      payload: { name: existing.name },
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
