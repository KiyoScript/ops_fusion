import { prisma } from "@/lib/prisma";

export type ModuleFlagRow = { key: string; enabled: boolean };

export interface IModuleFlagRepository {
  /** Every stored override (missing keys fall back to coded defaults). */
  listOverrides(): Promise<ModuleFlagRow[]>;
  /** Upsert one module's on/off state. */
  set(key: string, enabled: boolean): Promise<void>;
}

export class PrismaModuleFlagRepository implements IModuleFlagRepository {
  async listOverrides(): Promise<ModuleFlagRow[]> {
    return prisma.moduleFlag.findMany({ select: { key: true, enabled: true } });
  }

  async set(key: string, enabled: boolean): Promise<void> {
    await prisma.moduleFlag.upsert({
      where: { key },
      create: { key, enabled },
      update: { enabled },
    });
  }
}
