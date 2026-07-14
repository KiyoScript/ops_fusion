import { prisma } from "@/lib/prisma";
import type { ProductOptionDto } from "@/app/api/products/route";

/** Loads one active product + its price rules as the DTO the wizards read.
 *  Looks up by id (from the chooser) or falls back to name. */
export async function resolveWizardProduct(
  productId: string | undefined,
  fallbackName: string
): Promise<ProductOptionDto | null> {
  const row = await prisma.product.findFirst({
    where: {
      deletedAt: null,
      isActive: true,
      ...(productId
        ? { id: productId }
        : { name: { equals: fallbackName, mode: "insensitive" } }),
    },
    select: {
      id: true,
      name: true,
      category: true,
      unit: true,
      basePrice: true,
      description: true,
      priceRules: {
        where: { isActive: true },
        orderBy: [{ sortOrder: "asc" }, { minQty: "asc" }],
        select: {
          type: true,
          label: true,
          unitPrice: true,
          minQty: true,
          minCharge: true,
          amount: true,
          pct: true,
          notes: true,
        },
      },
    },
  });
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    category: row.category,
    unit: row.unit,
    basePrice: row.basePrice.toString(),
    description: row.description,
    rules: row.priceRules.map((r) => ({
      type: r.type,
      label: r.label,
      unitPrice: r.unitPrice?.toString() ?? null,
      minQty: r.minQty,
      minCharge: r.minCharge?.toString() ?? null,
      amount: r.amount?.toString() ?? null,
      pct: r.pct?.toString() ?? null,
      notes: r.notes,
    })),
    productionSteps: [], // wizards don't need the workflow template
  };
}
