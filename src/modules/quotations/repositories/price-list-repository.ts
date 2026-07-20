import { prisma } from "@/lib/prisma";
import type { PriceRuleType } from "@/generated/prisma/enums";
import type { DbTx } from "@/modules/shared/repositories/types";

export type RuleCreateData = {
  type: PriceRuleType;
  label: string;
  unitPrice?: string | null;
  minQty: number;
  minCharge?: string | null;
  amount?: string | null;
  pct?: string | null;
  notes?: string | null;
  sortOrder: number;
};

export type ProductRef = { id: string; name: string; created: boolean };

export type ProductFields = {
  name: string;
  category: string;
  unit: string;
  basePrice: string;
  description?: string | null;
};

export interface IPriceListRepository {
  withTransaction<T>(fn: (tx: DbTx) => Promise<T>): Promise<T>;
  /** Case-insensitive find-or-create; basePrice/category/unit apply only on create. */
  findOrCreateProduct(
    data: {
      name: string;
      category: string;
      unit: string;
      basePrice: string;
      createdById: string;
    },
    tx?: DbTx
  ): Promise<ProductRef>;
  /** Replace-from-file semantics: the spreadsheet is the source of truth. */
  replaceRules(
    productId: string,
    rules: RuleCreateData[],
    tx?: DbTx
  ): Promise<void>;
  findProductByName(name: string, excludeId?: string): Promise<string | null>;
  findProductById(id: string): Promise<{ id: string; name: string } | null>;
  createProduct(
    data: ProductFields & { createdById: string },
    tx?: DbTx
  ): Promise<{ id: string }>;
  updateProduct(id: string, data: ProductFields, tx?: DbTx): Promise<void>;
  softDeleteProduct(id: string, tx?: DbTx): Promise<void>;
  /** Soft-delete every active product — returns how many were removed. */
  softDeleteAllProducts(tx?: DbTx): Promise<number>;
  /** Global add-ons: rules with NO product — offered on every product. */
  listGlobalAddons(): Promise<GlobalAddonRow[]>;
  replaceGlobalAddons(rules: RuleCreateData[], tx?: DbTx): Promise<void>;
}

export type GlobalAddonRow = {
  label: string;
  amount: string | null;
  pct: string | null;
  notes: string | null;
};

export class PrismaPriceListRepository implements IPriceListRepository {
  withTransaction<T>(fn: (tx: DbTx) => Promise<T>): Promise<T> {
    return prisma.$transaction(fn);
  }

  async findOrCreateProduct(
    data: {
      name: string;
      category: string;
      unit: string;
      basePrice: string;
      createdById: string;
    },
    tx?: DbTx
  ): Promise<ProductRef> {
    const db = tx ?? prisma;
    const existing = await db.product.findFirst({
      where: {
        deletedAt: null,
        name: { equals: data.name, mode: "insensitive" },
      },
      select: { id: true, name: true },
    });
    if (existing) return { ...existing, created: false };
    const created = await db.product.create({
      data,
      select: { id: true, name: true },
    });
    return { ...created, created: true };
  }

  async replaceRules(
    productId: string,
    rules: RuleCreateData[],
    tx?: DbTx
  ): Promise<void> {
    const db = tx ?? prisma;
    await db.priceRule.deleteMany({ where: { productId } });
    if (rules.length > 0) {
      await db.priceRule.createMany({
        data: rules.map((rule) => ({ ...rule, productId })),
      });
    }
  }

  async findProductByName(
    name: string,
    excludeId?: string
  ): Promise<string | null> {
    const found = await prisma.product.findFirst({
      where: {
        deletedAt: null,
        name: { equals: name, mode: "insensitive" },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    return found?.id ?? null;
  }

  async findProductById(
    id: string
  ): Promise<{ id: string; name: string } | null> {
    return prisma.product.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, name: true },
    });
  }

  async createProduct(
    data: ProductFields & { createdById: string },
    tx?: DbTx
  ): Promise<{ id: string }> {
    return (tx ?? prisma).product.create({ data, select: { id: true } });
  }

  async updateProduct(
    id: string,
    data: ProductFields,
    tx?: DbTx
  ): Promise<void> {
    await (tx ?? prisma).product.update({ where: { id }, data });
  }

  async softDeleteProduct(id: string, tx?: DbTx): Promise<void> {
    await (tx ?? prisma).product.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  async softDeleteAllProducts(tx?: DbTx): Promise<number> {
    const result = await (tx ?? prisma).product.updateMany({
      where: { deletedAt: null },
      data: { deletedAt: new Date(), isActive: false },
    });
    return result.count;
  }

  async listGlobalAddons(): Promise<GlobalAddonRow[]> {
    const rows = await prisma.priceRule.findMany({
      where: { productId: null, isActive: true },
      orderBy: { sortOrder: "asc" },
      select: { label: true, amount: true, pct: true, notes: true },
    });
    return rows.map((r) => ({
      label: r.label,
      amount: r.amount?.toString() ?? null,
      pct: r.pct?.toString() ?? null,
      notes: r.notes,
    }));
  }

  async replaceGlobalAddons(rules: RuleCreateData[], tx?: DbTx): Promise<void> {
    const db = tx ?? prisma;
    await db.priceRule.deleteMany({ where: { productId: null } });
    if (rules.length > 0) {
      await db.priceRule.createMany({
        data: rules.map((rule) => ({ ...rule, productId: null })),
      });
    }
  }
}
