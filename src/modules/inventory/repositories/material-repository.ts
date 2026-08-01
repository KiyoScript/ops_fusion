import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { MaterialStatus } from "@/generated/prisma/enums";
import type { DbTx } from "@/modules/shared/repositories/types";
import type { MaterialInput, MaterialListFilters } from "../schemas/material";

const materialSelect = {
  id: true,
  code: true,
  name: true,
  category: true,
  location: true,
  area: true,
  unit: true,
  packSize: true,
  unitCost: true,
  unitPrice: true,
  reorderLevel: true,
  status: true,
  possibleOffcut: true,
  notes: true,
  createdAt: true,
  supplier: { select: { id: true, name: true } },
} satisfies Prisma.MaterialSelect;

export type MaterialRecord = Prisma.MaterialGetPayload<{
  select: typeof materialSelect;
}>;

// Persisted columns from a validated form input (openingQty is orchestrated by
// the service, not stored on the row).
type MaterialWrite = Omit<MaterialInput, "openingQty">;

export interface IMaterialRepository {
  withTransaction<T>(fn: (tx: DbTx) => Promise<T>): Promise<T>;
  listPage(
    filter: MaterialListFilters
  ): Promise<{ rows: MaterialRecord[]; nextCursor: string | null }>;
  findById(id: string): Promise<MaterialRecord | null>;
  /** Fetch several materials at once (for validating stock-op line items). */
  listByIds(ids: string[]): Promise<MaterialRecord[]>;
  codeExists(code: string, excludeId?: string): Promise<boolean>;
  create(
    data: MaterialWrite,
    createdById: string,
    tx: DbTx
  ): Promise<{ id: string; code: string }>;
  update(id: string, data: MaterialWrite, tx: DbTx): Promise<void>;
  softDelete(id: string): Promise<void>;
  /** Distinct code prefixes already in use (the part before the first dash). */
  listPrefixes(): Promise<string[]>;
  /** Highest running number for a prefix, e.g. prefix "PAP" → 12 for PAP-012. */
  maxSeqForPrefix(prefix: string): Promise<number>;
  /** Active materials that track a reorder level — input to the reorder report. */
  listReorderCandidates(): Promise<MaterialRecord[]>;
}

export class PrismaMaterialRepository implements IMaterialRepository {
  withTransaction<T>(fn: (tx: DbTx) => Promise<T>): Promise<T> {
    return prisma.$transaction(fn);
  }

  async listPage(
    filter: MaterialListFilters
  ): Promise<{ rows: MaterialRecord[]; nextCursor: string | null }> {
    const where: Prisma.MaterialWhereInput = { deletedAt: null };
    if (filter.status) where.status = filter.status;
    if (filter.category) where.category = filter.category;
    if (filter.q) {
      where.OR = [
        { code: { contains: filter.q, mode: "insensitive" } },
        { name: { contains: filter.q, mode: "insensitive" } },
        { category: { contains: filter.q, mode: "insensitive" } },
      ];
    }
    const rows = await prisma.material.findMany({
      where,
      select: materialSelect,
      orderBy: [{ code: "asc" }, { id: "asc" }],
      take: filter.take + 1,
      ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > filter.take;
    const page = hasMore ? rows.slice(0, filter.take) : rows;
    return {
      rows: page,
      nextCursor: hasMore ? page[page.length - 1]!.id : null,
    };
  }

  async findById(id: string): Promise<MaterialRecord | null> {
    return prisma.material.findFirst({
      where: { id, deletedAt: null },
      select: materialSelect,
    });
  }

  async listByIds(ids: string[]): Promise<MaterialRecord[]> {
    if (ids.length === 0) return [];
    return prisma.material.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: materialSelect,
    });
  }

  async codeExists(code: string, excludeId?: string): Promise<boolean> {
    const found = await prisma.material.findFirst({
      where: {
        code: { equals: code, mode: "insensitive" },
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    return !!found;
  }

  async create(
    data: MaterialWrite,
    createdById: string,
    tx: DbTx
  ): Promise<{ id: string; code: string }> {
    return tx.material.create({
      data: {
        code: data.code,
        name: data.name,
        category: data.category || null,
        location: data.location || null,
        area: data.area || null,
        unit: data.unit,
        packSize: data.packSize,
        unitCost: data.unitCost,
        unitPrice: data.unitPrice ?? null,
        reorderLevel: data.reorderLevel,
        status: data.status,
        possibleOffcut: data.possibleOffcut,
        notes: data.notes || null,
        supplierId: data.supplierId || null,
        createdById,
      },
      select: { id: true, code: true },
    });
  }

  async update(id: string, data: MaterialWrite, tx: DbTx): Promise<void> {
    await tx.material.update({
      where: { id },
      data: {
        code: data.code,
        name: data.name,
        category: data.category || null,
        location: data.location || null,
        area: data.area || null,
        unit: data.unit,
        packSize: data.packSize,
        unitCost: data.unitCost,
        unitPrice: data.unitPrice ?? null,
        reorderLevel: data.reorderLevel,
        status: data.status,
        possibleOffcut: data.possibleOffcut,
        notes: data.notes || null,
        supplierId: data.supplierId || null,
      },
    });
  }

  async softDelete(id: string): Promise<void> {
    await prisma.material.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async listPrefixes(): Promise<string[]> {
    const rows = await prisma.material.findMany({
      where: { deletedAt: null },
      select: { code: true },
    });
    const set = new Set<string>();
    for (const { code } of rows) {
      const dash = code.indexOf("-");
      if (dash > 0) set.add(code.slice(0, dash).toUpperCase());
    }
    return [...set].sort();
  }

  async maxSeqForPrefix(prefix: string): Promise<number> {
    const rows = await prisma.material.findMany({
      where: {
        deletedAt: null,
        code: { startsWith: `${prefix}-`, mode: "insensitive" },
      },
      select: { code: true },
    });
    let max = 0;
    for (const { code } of rows) {
      const tail = code.slice(prefix.length + 1);
      const n = parseInt(tail, 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
    return max;
  }

  async listReorderCandidates(): Promise<MaterialRecord[]> {
    return prisma.material.findMany({
      where: {
        deletedAt: null,
        status: MaterialStatus.ACTIVE,
        reorderLevel: { gt: 0 },
      },
      select: materialSelect,
      orderBy: [{ code: "asc" }],
    });
  }
}
