import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { ProductRuleDto } from "../route";

// GET /api/products/global-addons — the common add-on fees (rush, design,
// delivery…) offered on EVERY product; a product-level add-on with the same
// label overrides its global counterpart.
export async function GET() {
  try {
    await requireActor();
    const rows = await prisma.priceRule.findMany({
      where: { productId: null, isActive: true },
      orderBy: { sortOrder: "asc" },
      select: {
        label: true,
        amount: true,
        pct: true,
        notes: true,
      },
    });
    const addons: ProductRuleDto[] = rows.map((rule) => ({
      type: "ADDON",
      label: rule.label,
      unitPrice: null,
      minQty: 1,
      minCharge: null,
      amount: rule.amount?.toString() ?? null,
      pct: rule.pct?.toString() ?? null,
      notes: rule.notes,
    }));
    return NextResponse.json(ok(addons));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
