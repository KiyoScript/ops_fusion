import { prisma } from "@/lib/prisma";
import type { LookupType } from "@/generated/prisma/enums";

export type LookupRecord = {
  id: string;
  type: LookupType;
  label: string;
  isLFP: boolean;
  isActive: boolean;
  sortOrder: number;
};

const lookupSelect = {
  id: true,
  type: true,
  label: true,
  isLFP: true,
  isActive: true,
  sortOrder: true,
} as const;

export interface ILookupRepository {
  listByType(type: LookupType, includeInactive: boolean): Promise<LookupRecord[]>;
  findById(id: string): Promise<LookupRecord | null>;
  existsLabel(
    type: LookupType,
    label: string,
    excludeId?: string
  ): Promise<boolean>;
  nextSortOrder(type: LookupType): Promise<number>;
  create(data: {
    type: LookupType;
    label: string;
    isLFP: boolean;
    sortOrder: number;
    createdById: string;
  }): Promise<LookupRecord>;
  createMany(
    data: {
      type: LookupType;
      label: string;
      isLFP: boolean;
      sortOrder: number;
      createdById: string;
    }[]
  ): Promise<number>;
  update(
    id: string,
    data: { label?: string; isLFP?: boolean; isActive?: boolean }
  ): Promise<void>;
  delete(id: string): Promise<void>;
}

export class PrismaLookupRepository implements ILookupRepository {
  async listByType(
    type: LookupType,
    includeInactive: boolean
  ): Promise<LookupRecord[]> {
    return prisma.lookupOption.findMany({
      where: { type, ...(includeInactive ? {} : { isActive: true }) },
      select: lookupSelect,
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    });
  }

  async findById(id: string): Promise<LookupRecord | null> {
    return prisma.lookupOption.findUnique({
      where: { id },
      select: lookupSelect,
    });
  }

  async existsLabel(
    type: LookupType,
    label: string,
    excludeId?: string
  ): Promise<boolean> {
    const found = await prisma.lookupOption.findFirst({
      where: {
        type,
        label: { equals: label, mode: "insensitive" },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    return !!found;
  }

  async nextSortOrder(type: LookupType): Promise<number> {
    const max = await prisma.lookupOption.aggregate({
      where: { type },
      _max: { sortOrder: true },
    });
    return (max._max.sortOrder ?? -1) + 1;
  }

  async create(data: {
    type: LookupType;
    label: string;
    isLFP: boolean;
    sortOrder: number;
    createdById: string;
  }): Promise<LookupRecord> {
    return prisma.lookupOption.create({ data, select: lookupSelect });
  }

  async createMany(
    data: {
      type: LookupType;
      label: string;
      isLFP: boolean;
      sortOrder: number;
      createdById: string;
    }[]
  ): Promise<number> {
    if (data.length === 0) return 0;
    const result = await prisma.lookupOption.createMany({ data });
    return result.count;
  }

  async update(
    id: string,
    data: { label?: string; isLFP?: boolean; isActive?: boolean }
  ): Promise<void> {
    await prisma.lookupOption.update({ where: { id }, data });
  }

  async delete(id: string): Promise<void> {
    await prisma.lookupOption.delete({ where: { id } });
  }
}
