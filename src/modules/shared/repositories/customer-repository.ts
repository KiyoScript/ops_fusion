import { prisma } from "@/lib/prisma";
import type { DbTx } from "./types";

export type CustomerOption = { id: string; name: string };

/** Search result for pickers — carries contact/company so similar-sounding
 *  names are distinguishable in the dropdown. */
export type CustomerSuggestion = CustomerOption & {
  contactNumber: string | null;
  company: string | null;
};

export interface ICustomerRepository {
  search(query: string, take?: number): Promise<CustomerSuggestion[]>;
  findOrCreateByName(
    name: string,
    createdById: string,
    tx?: DbTx
  ): Promise<CustomerOption>;
  /** Batch variant for imports: returns a map of lowercased name → id. */
  findOrCreateManyByName(
    names: string[],
    createdById: string
  ): Promise<{ idByName: Map<string, string>; created: number }>;
}

export class PrismaCustomerRepository implements ICustomerRepository {
  async search(query: string, take = 10): Promise<CustomerSuggestion[]> {
    return prisma.customer.findMany({
      where: {
        deletedAt: null,
        name: { contains: query, mode: "insensitive" },
      },
      select: { id: true, name: true, contactNumber: true, company: true },
      orderBy: { name: "asc" },
      take,
    });
  }

  async findOrCreateByName(
    name: string,
    createdById: string,
    tx?: DbTx
  ): Promise<CustomerOption> {
    const db = tx ?? prisma;
    const trimmed = name.trim();
    const existing = await db.customer.findFirst({
      where: { deletedAt: null, name: { equals: trimmed, mode: "insensitive" } },
      select: { id: true, name: true },
    });
    if (existing) return existing;
    return db.customer.create({
      data: { name: trimmed, createdById },
      select: { id: true, name: true },
    });
  }

  async findOrCreateManyByName(
    names: string[],
    createdById: string
  ): Promise<{ idByName: Map<string, string>; created: number }> {
    const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
    const idByName = new Map<string, string>();
    if (unique.length === 0) return { idByName, created: 0 };

    const existing = await prisma.customer.findMany({
      where: {
        deletedAt: null,
        OR: unique.map((n) => ({ name: { equals: n, mode: "insensitive" as const } })),
      },
      select: { id: true, name: true },
    });
    for (const c of existing) idByName.set(c.name.toLowerCase(), c.id);

    const missing = unique.filter((n) => !idByName.has(n.toLowerCase()));
    if (missing.length > 0) {
      const created = await prisma.customer.createManyAndReturn({
        data: missing.map((name) => ({ name, createdById })),
        select: { id: true, name: true },
      });
      for (const c of created) idByName.set(c.name.toLowerCase(), c.id);
    }
    return { idByName, created: missing.length };
  }
}
