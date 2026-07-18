import { cache } from "react";
import { assertCan } from "@/lib/ability";
import type { Actor } from "@/lib/authz";
import { ValidationError } from "@/lib/errors";
import {
  MODULES,
  MODULE_KEYS,
  resolveEnabledModules,
  type ModuleDef,
  type ModuleKey,
} from "@/lib/modules";
import type { IActivityLogRepository } from "@/modules/shared/repositories/activity-log-repository";
import { PrismaActivityLogRepository } from "@/modules/shared/repositories/activity-log-repository";
import type { IModuleFlagRepository } from "../repositories/module-flag-repository";
import { PrismaModuleFlagRepository } from "../repositories/module-flag-repository";

export type ModuleFlagDto = ModuleDef & { enabled: boolean };

const isModuleKey = (v: string): v is ModuleKey =>
  (MODULE_KEYS as readonly string[]).includes(v);

export class ModuleFlagService {
  constructor(
    private readonly flags: IModuleFlagRepository,
    private readonly activity: IActivityLogRepository
  ) {}

  /** Every module with its resolved on/off state, for the Settings toggles.
   *  Not permission-gated here — the Settings page is admin-only. */
  async list(): Promise<ModuleFlagDto[]> {
    const enabled = await this.enabledKeys();
    return MODULES.map((m) => ({ ...m, enabled: enabled.has(m.key) }));
  }

  /** Turn a module on/off. Admin only (ModuleFlag ⇒ manage-all). */
  async setEnabled(
    actor: Actor,
    key: string,
    enabled: boolean
  ): Promise<void> {
    assertCan(actor, "update", "ModuleFlag");
    if (!isModuleKey(key)) throw new ValidationError("Unknown module.");
    await this.flags.set(key, enabled);
    await this.activity.log({
      userId: actor.id,
      entityType: "ModuleFlag",
      entityId: key,
      action: enabled ? "module-enabled" : "module-disabled",
      payload: { key, enabled },
    });
  }

  /** The set of enabled module keys — deduped per request (React cache). */
  private enabledKeys = cache(async (): Promise<Set<ModuleKey>> => {
    const rows = await this.flags.listOverrides();
    return resolveEnabledModules(new Map(rows.map((r) => [r.key, r.enabled])));
  });
}

let instance: ModuleFlagService | undefined;

export function getModuleFlagService(): ModuleFlagService {
  instance ??= new ModuleFlagService(
    new PrismaModuleFlagRepository(),
    new PrismaActivityLogRepository()
  );
  return instance;
}

/** Server helper for the layout/route guard: the set of enabled module keys,
 *  deduped per request. */
export const getEnabledModuleKeys = cache(
  async (): Promise<Set<ModuleKey>> => {
    const rows = await new PrismaModuleFlagRepository().listOverrides();
    return resolveEnabledModules(new Map(rows.map((r) => [r.key, r.enabled])));
  }
);
