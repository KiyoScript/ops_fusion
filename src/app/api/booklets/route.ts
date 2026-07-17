import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok, ValidationError } from "@/lib/errors";
import { getBookletService } from "@/modules/sales-audit/services";
import {
  bookletListFilters,
  createBookletInput,
} from "@/modules/sales-audit/schemas/booklet";

// GET /api/booklets?type=&status= — the booklet register.
export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const parsed = bookletListFilters.safeParse(params);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Invalid filters."
      );
    }
    const booklets = await getBookletService().list(actor, parsed.data);
    return NextResponse.json(ok(booklets));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}

// POST /api/booklets — register a booklet (lands as PENDING_APPROVAL).
export async function POST(request: Request) {
  try {
    const actor = await requireActor();
    const parsed = createBookletInput.safeParse(await request.json());
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Invalid booklet."
      );
    }
    const created = await getBookletService().create(actor, parsed.data);
    return NextResponse.json(ok(created));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
