import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

export type ProductOptionDto = {
  id: string;
  name: string;
  category: string;
  unit: string;
  basePrice: string;
  description: string | null;
};

// GET /api/products — active catalog for the quotation line-item picker.
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
      },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });
    const options: ProductOptionDto[] = rows.map((row) => ({
      ...row,
      basePrice: row.basePrice.toString(),
    }));
    return NextResponse.json(ok(options));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
