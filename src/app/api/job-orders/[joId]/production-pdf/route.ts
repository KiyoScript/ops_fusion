import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail } from "@/lib/errors";
import { getJobOrderService } from "@/modules/job-orders/services";
import { renderJoProductionPdf } from "@/modules/job-orders/services/jo-production-pdf";

// GET /api/job-orders/:joId/production-pdf — the internal PRODUCTION worksheet
// (line items + per-item production-step checklist), separate from the
// customer-approval PDF at /pdf.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ joId: string }> }
) {
  try {
    const actor = await requireActor();
    const { joId } = await params;
    const { jo, fin } = await getJobOrderService().getProductionData(actor, joId);
    const bytes = await renderJoProductionPdf(jo, fin);
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${jo.joNumber.replace(/[^\w.-]+/g, "_")}-production.pdf"`,
      },
    });
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
