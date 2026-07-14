import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail } from "@/lib/errors";
import { getQuotationService } from "@/modules/quotations/services";
import { renderQuotationPdf } from "@/modules/quotations/services/quotation-pdf";

// GET /api/quotations/:quotationId/pdf — the quotation printable (carries a
// DRAFT banner until the supervisor approves).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ quotationId: string }> }
) {
  try {
    const actor = await requireActor();
    const { quotationId } = await params;
    const quote = await getQuotationService().get(actor, quotationId);
    const bytes = await renderQuotationPdf(quote);
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${quote.quoteNumber.replace(/[^\w.-]+/g, "_")}.pdf"`,
      },
    });
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
