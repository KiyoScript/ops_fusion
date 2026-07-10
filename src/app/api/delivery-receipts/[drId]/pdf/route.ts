import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail } from "@/lib/errors";
import { getDeliveryReceiptService } from "@/modules/delivery-receipts/services";
import { renderDrPdf } from "@/modules/delivery-receipts/services/dr-pdf";

// GET /api/delivery-receipts/:drId/pdf — the DR printable.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ drId: string }> }
) {
  try {
    const actor = await requireActor();
    const { drId } = await params;
    const dr = await getDeliveryReceiptService().get(actor, drId);
    const bytes = await renderDrPdf(dr);
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${dr.drNumber.replace(/[^\w.-]+/g, "_")}.pdf"`,
      },
    });
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
