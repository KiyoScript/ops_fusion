import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

export type NewspaperPublicationDto = { id: string; name: string };

// GET /api/newspaper/publications — active publications for the calculator picker.
export async function GET() {
  try {
    await requireActor();
    const rows = await prisma.newspaperPublication.findMany({
      where: { deletedAt: null, isActive: true },
      select: { id: true, name: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    return NextResponse.json(ok(rows satisfies NewspaperPublicationDto[]));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
