import { prisma } from "@/lib/prisma";

export type CreditTermRecord = {
  id: string;
  days: number;
  isActive: boolean;
  sortOrder: number;
};

export interface ICreditTermRepository {
  list(includeInactive: boolean): Promise<CreditTermRecord[]>;
  /** Just the active day-counts, ascending — for dropdowns. */
  listActiveDays(): Promise<number[]>;
  findByDays(days: number): Promise<CreditTermRecord | null>;
  create(days: number): Promise<CreditTermRecord>;
  setActive(id: string, isActive: boolean): Promise<void>;
  delete(id: string): Promise<void>;
}

const select = { id: true, days: true, isActive: true, sortOrder: true } as const;

export class PrismaCreditTermRepository implements ICreditTermRepository {
  async list(includeInactive: boolean): Promise<CreditTermRecord[]> {
    return prisma.creditTerm.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { days: "asc" }],
      select,
    });
  }

  async listActiveDays(): Promise<number[]> {
    const rows = await prisma.creditTerm.findMany({
      where: { isActive: true },
      orderBy: { days: "asc" },
      select: { days: true },
    });
    return rows.map((r) => r.days);
  }

  async findByDays(days: number): Promise<CreditTermRecord | null> {
    return prisma.creditTerm.findUnique({ where: { days }, select });
  }

  async create(days: number): Promise<CreditTermRecord> {
    const max = await prisma.creditTerm.aggregate({ _max: { sortOrder: true } });
    return prisma.creditTerm.create({
      data: { days, sortOrder: (max._max.sortOrder ?? -1) + 1 },
      select,
    });
  }

  async setActive(id: string, isActive: boolean): Promise<void> {
    await prisma.creditTerm.update({ where: { id }, data: { isActive } });
  }

  async delete(id: string): Promise<void> {
    await prisma.creditTerm.delete({ where: { id } });
  }
}
