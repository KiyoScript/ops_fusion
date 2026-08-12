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
      isLFP: true,
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

  // Global add-ons (productId NULL) apply to every product and WIN over a
  // product-level add-on of the same fee — save "Rush Fee" once in
  // Maintenance and every quote flow uses it, even where the product carries
  // its own "Rush" row. Fees match by normalized name ("Rush" == "Rush Fee").
  const globals = await prisma.priceRule.findMany({
    where: { productId: null, isActive: true },
    orderBy: { sortOrder: "asc" },
    select: { label: true, amount: true, pct: true, notes: true },
  });
  const feeKey = (label: string) =>
    label
      .toLowerCase()
      .replace(/\bfees?\b/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const globalKeys = new Set(globals.map((g) => feeKey(g.label)));

  return {
    id: row.id,
    name: row.name,
    category: row.category,
    unit: row.unit,
    basePrice: row.basePrice.toString(),
    description: row.description,
    isLFP: row.isLFP,
    rules: [
      ...row.priceRules
        .filter((r) => r.type !== "ADDON" || !globalKeys.has(feeKey(r.label)))
        .map((r) => ({
          type: r.type,
          label: r.label,
          unitPrice: r.unitPrice?.toString() ?? null,
          minQty: r.minQty,
          minCharge: r.minCharge?.toString() ?? null,
          amount: r.amount?.toString() ?? null,
          pct: r.pct?.toString() ?? null,
          notes: r.notes,
        })),
      ...globals.map((g) => ({
        type: "ADDON" as const,
        label: g.label,
        unitPrice: null,
        minQty: 1,
        minCharge: null,
        amount: g.amount?.toString() ?? null,
        pct: g.pct?.toString() ?? null,
        notes: g.notes,
      })),
    ],
    productionSteps: [], // wizards don't need the workflow template
  };
}
