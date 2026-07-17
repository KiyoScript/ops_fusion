import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok } from "@/lib/errors";
import { getReceiptService } from "@/modules/sales-audit/services";

// GET /api/job-orders/:joId/payment-options — everything the Receive Payment
// dialog opens with: the customer (name / address / TIN already on the JO),
// what's been received, and the next number on each booklet.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ joId: string }> }
) {
  try {
    const actor = await requireActor();
    const { joId } = await params;
    const options = await getReceiptService().getPaymentOptions(actor, joId);
    return NextResponse.json(ok(options));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
