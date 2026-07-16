import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok, ValidationError } from "@/lib/errors";
import { getBookletService } from "@/modules/sales-audit/services";

type Params = { params: Promise<{ bookletId: string }> };

// POST /api/booklets/:id — booklet lifecycle: approve | reject | re-request | close.
// One route: these are all state moves on the same record, and each is guarded
// separately in the service (only an admin may approve).
export async function POST(request: Request, { params }: Params) {
  try {
    const actor = await requireActor();
    const { bookletId } = await params;
    const body = (await request.json()) as { action?: string; note?: string };
    const booklets = getBookletService();

    switch (body.action) {
      case "approve":
        await booklets.approve(actor, bookletId);
        break;
      case "reject":
        await booklets.reject(actor, { id: bookletId, note: body.note });
        break;
      case "re-request":
        await booklets.reRequest(actor, bookletId);
        break;
      case "close":
        await booklets.close(actor, bookletId);
        break;
      default:
        throw new ValidationError("Unknown booklet action.");
    }
    return NextResponse.json(ok({ id: bookletId }));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}

// DELETE /api/booklets/:id — only while it has issued nothing.
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const actor = await requireActor();
    const { bookletId } = await params;
    await getBookletService().delete(actor, bookletId);
    return NextResponse.json(ok({ id: bookletId }));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
