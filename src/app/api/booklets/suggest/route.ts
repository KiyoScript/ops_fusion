import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok, ValidationError } from "@/lib/errors";
import { BookletType } from "@/generated/prisma/enums";
import { getBookletService } from "@/modules/sales-audit/services";

// GET /api/booklets/suggest?type=SI_VAT — the next free range for a booklet
// type, pre-filling the register form. The admin can overwrite it.
export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    const type = new URL(request.url).searchParams.get("type");
    if (!type || !(type in BookletType)) {
      throw new ValidationError("Choose a document type.");
    }
    const suggestion = await getBookletService().suggestRange(
      actor,
      type as BookletType
    );
    return NextResponse.json(ok(suggestion));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
