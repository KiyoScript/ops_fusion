import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok } from "@/lib/errors";
import {
  priceNewspaper,
  type NewspaperPrice,
} from "@/modules/quotations/services/newspaper-pricing";

// GET /api/newspaper/price?publicationId=&kind=&colorPages=&bwPages=&copies=
// Live price for the newspaper calculator: exact table hit → formula fallback.
// totalPages is derived (color + BW) — it drives the formula's paper cost.
export async function GET(request: Request) {
  try {
    await requireActor();
    const p = new URL(request.url).searchParams;
    const publicationId = p.get("publicationId") ?? "";
    const colorPages = Math.max(0, Math.trunc(Number(p.get("colorPages") ?? 0)));
    const bwPages = Math.max(0, Math.trunc(Number(p.get("bwPages") ?? 0)));
    const copies = Math.max(0, Math.trunc(Number(p.get("copies") ?? 0)));
    const kind = p.get("kind") === "LOOSE_PAGES" ? "LOOSE_PAGES" : "FULL_ISSUE";

    if (!publicationId || copies <= 0 || colorPages + bwPages <= 0) {
      return NextResponse.json(ok(null as NewspaperPrice | null));
    }
    const price = await priceNewspaper({
      publicationId,
      kind,
      totalPages: colorPages + bwPages,
      colorPages,
      bwPages,
      copies,
    });
    return NextResponse.json(ok(price));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
