import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok } from "@/lib/errors";
import { getQuotationService } from "@/modules/quotations/services";

// GET /api/quotations/:quotationId — full detail for the detail/edit views.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ quotationId: string }> }
) {
  try {
    const actor = await requireActor();
    const { quotationId } = await params;
    const detail = await getQuotationService().get(actor, quotationId);
    return NextResponse.json(ok(detail));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
