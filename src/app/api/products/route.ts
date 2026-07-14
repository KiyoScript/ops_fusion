import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

// Parametric pricing rule of one product (see PriceRule in schema.prisma).
export type ProductRuleDto = {
  type: "VARIANT" | "ADDON";
  label: string;
  unitPrice: string | null;
  minQty: number;
  minCharge: string | null;
  amount: string | null;
  pct: string | null;
  notes: string | null;
};

export type ProductOptionDto = {
  id: string;
  name: string;
  category: string;
  unit: string;
  basePrice: string;
  description: string | null;
  rules: ProductRuleDto[];
};

// GET /api/products — active catalog + price rules for the quotation
// line-item picker (variants/tiers/addons drive the calculators).
export async function GET() {
  try {
    await requireActor();
    const rows = await prisma.product.findMany({
      where: { deletedAt: null, isActive: true },
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
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });
    const options: ProductOptionDto[] = rows.map((row) => ({
      id: row.id,
      name: row.name,
      category: row.category,
      unit: row.unit,
      basePrice: row.basePrice.toString(),
      description: row.description,
      rules: row.priceRules.map((rule) => ({
        type: rule.type,
        label: rule.label,
        unitPrice: rule.unitPrice?.toString() ?? null,
        minQty: rule.minQty,
        minCharge: rule.minCharge?.toString() ?? null,
        amount: rule.amount?.toString() ?? null,
        pct: rule.pct?.toString() ?? null,
        notes: rule.notes,
      })),
    }));
    return NextResponse.json(ok(options));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
