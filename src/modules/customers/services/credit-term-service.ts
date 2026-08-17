import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { type Actor } from "@/lib/authz";
import { assertCan } from "@/lib/ability";
import type { IActivityLogRepository } from "@/modules/shared/repositories/activity-log-repository";
import { PrismaActivityLogRepository } from "@/modules/shared/repositories/activity-log-repository";
import type {
  CreditTermRecord,
  ICreditTermRepository,
} from "../repositories/credit-term-repository";
import { PrismaCreditTermRepository } from "../repositories/credit-term-repository";

export class CreditTermService {
  constructor(
    private readonly repo: ICreditTermRepository,
    private readonly activity: IActivityLogRepository
  ) {}

  // The maintained list itself is admin reference data — every mutation below
  // already gates on it, and listing it (including the inactive entries) is
  // part of the same maintenance screen (docs/sales-contract.md R9).
  list(actor: Actor, includeInactive = false): Promise<CreditTermRecord[]> {
    assertCan(actor, "maintain", "Maintenance");
    return this.repo.list(includeInactive);
  }

  /** Active day-counts for a customer/company credit-terms dropdown. */
  listActiveDays(): Promise<number[]> {
    return this.repo.listActiveDays();
  }

  async create(actor: Actor, days: number): Promise<CreditTermRecord> {
    assertCan(actor, "maintain", "Maintenance");
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      throw new ValidationError("Enter a whole number of days (1–365).");
    }
    if (await this.repo.findByDays(days)) {
      throw new ConflictError(`${days}-day terms already exist.`);
    }
    const created = await this.repo.create(days);
    await this.activity.log({
      userId: actor.id,
      entityType: "CreditTerm",
      entityId: created.id,
      action: "create",
      payload: { days },
    });
    return created;
  }

  async setActive(actor: Actor, id: string, isActive: boolean): Promise<void> {
    assertCan(actor, "maintain", "Maintenance");
    await this.repo.setActive(id, isActive);
    await this.activity.log({
      userId: actor.id,
      entityType: "CreditTerm",
      entityId: id,
      action: isActive ? "activate" : "deactivate",
      payload: {},
    });
  }

  async remove(actor: Actor, id: string): Promise<void> {
    assertCan(actor, "maintain", "Maintenance");
    const all = await this.repo.list(true);
    if (!all.some((t) => t.id === id)) {
      throw new NotFoundError("Credit term not found.");
    }
    await this.repo.delete(id);
    await this.activity.log({
      userId: actor.id,
      entityType: "CreditTerm",
      entityId: id,
      action: "delete",
      payload: {},
    });
  }
}

let instance: CreditTermService | undefined;

export function getCreditTermService(): CreditTermService {
  instance ??= new CreditTermService(
    new PrismaCreditTermRepository(),
    new PrismaActivityLogRepository()
  );
  return instance;
}
