import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail } from "@/lib/errors";
import { getJobOrderService } from "@/modules/job-orders/services";
import { renderJoPdf } from "@/modules/job-orders/services/jo-pdf";

// GET /api/job-orders/:joId/pdf — the JO/PO printable (always reflects the
// current state: "THIS IS FOR APPROVAL" until the customer approves).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ joId: string }> }
) {
  try {
    const actor = await requireActor();
    const { joId } = await params;
    const jo = await getJobOrderService().get(actor, joId);
    const bytes = await renderJoPdf(jo);
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${jo.joNumber.replace(/[^\w.-]+/g, "_")}.pdf"`,
      },
    });
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
