import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok } from "@/lib/errors";
import {
  listNewspaperRows,
  type NewspaperListRow,
} from "@/modules/quotations/services/newspaper-pricing";

export type { NewspaperListRow };

// GET /api/newspaper/rows?publicationId=&kind=
// The approved (quotable) price list for a publication + kind, so the quote
// calculator can present a pick-list instead of re-entering the spec.
export async function GET(request: Request) {
  try {
    await requireActor();
    const p = new URL(request.url).searchParams;
    const publicationId = p.get("publicationId") ?? "";
    const kind = p.get("kind") === "LOOSE_PAGES" ? "LOOSE_PAGES" : "FULL_ISSUE";
    if (!publicationId) {
      return NextResponse.json(ok([] as NewspaperListRow[]));
    }
    const rows = await listNewspaperRows(publicationId, kind);
    return NextResponse.json(ok(rows));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
