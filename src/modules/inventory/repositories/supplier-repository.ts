import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { SupplierStatus } from "@/generated/prisma/enums";
import type { SupplierInput, SupplierListFilters } from "../schemas/material";

const supplierSelect = {
  id: true,
  code: true,
  name: true,
  contactPerson: true,
  phone: true,
  email: true,
  address: true,
  notes: true,
  status: true,
  createdAt: true,
  _count: { select: { materials: { where: { deletedAt: null } } } },
} satisfies Prisma.SupplierSelect;

export type SupplierRecord = Prisma.SupplierGetPayload<{
  select: typeof supplierSelect;
}>;

export interface ISupplierRepository {
  list(filter: SupplierListFilters): Promise<SupplierRecord[]>;
  listActive(): Promise<{ id: string; name: string }[]>;
  findById(id: string): Promise<SupplierRecord | null>;
  codeExists(code: string, excludeId?: string): Promise<boolean>;
  create(data: SupplierInput, createdById: string): Promise<{ id: string }>;
  update(id: string, data: SupplierInput): Promise<void>;
  softDelete(id: string): Promise<void>;
  hasActiveMaterials(id: string): Promise<boolean>;
}

export class PrismaSupplierRepository implements ISupplierRepository {
  async list(filter: SupplierListFilters): Promise<SupplierRecord[]> {
    const where: Prisma.SupplierWhereInput = { deletedAt: null };
    if (!filter.includeInactive) where.status = SupplierStatus.ACTIVE;
    if (filter.q) {
      where.OR = [
        { name: { contains: filter.q, mode: "insensitive" } },
        { code: { contains: filter.q, mode: "insensitive" } },
        { contactPerson: { contains: filter.q, mode: "insensitive" } },
      ];
    }
    return prisma.supplier.findMany({
      where,
      select: supplierSelect,
      orderBy: [{ name: "asc" }],
      take: 500,
    });
  }

  async listActive(): Promise<{ id: string; name: string }[]> {
    return prisma.supplier.findMany({
      where: { deletedAt: null, status: SupplierStatus.ACTIVE },
      select: { id: true, name: true },
      orderBy: [{ name: "asc" }],
    });
  }

  async findById(id: string): Promise<SupplierRecord | null> {
    return prisma.supplier.findFirst({
      where: { id, deletedAt: null },
      select: supplierSelect,
    });
  }

  async codeExists(code: string, excludeId?: string): Promise<boolean> {
    const found = await prisma.supplier.findFirst({
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
    data: SupplierInput,
    createdById: string
  ): Promise<{ id: string }> {
    return prisma.supplier.create({
      data: {
        code: data.code || null,
        name: data.name,
        contactPerson: data.contactPerson || null,
        phone: data.phone || null,
        email: data.email || null,
        address: data.address || null,
        notes: data.notes || null,
        status: data.status,
        createdById,
      },
      select: { id: true },
    });
  }

  async update(id: string, data: SupplierInput): Promise<void> {
    await prisma.supplier.update({
      where: { id },
      data: {
        code: data.code || null,
        name: data.name,
        contactPerson: data.contactPerson || null,
        phone: data.phone || null,
        email: data.email || null,
        address: data.address || null,
        notes: data.notes || null,
        status: data.status,
      },
    });
  }

  async softDelete(id: string): Promise<void> {
    await prisma.supplier.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async hasActiveMaterials(id: string): Promise<boolean> {
    const found = await prisma.material.findFirst({
      where: { supplierId: id, deletedAt: null },
      select: { id: true },
    });
    return !!found;
  }
}
