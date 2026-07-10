import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok } from "@/lib/errors";
import { getDeliveryReceiptService } from "@/modules/delivery-receipts/services";

// GET /api/delivery-receipts/deliverable?jobOrderId= — completed JO items with
// quantity still to deliver (grouped by JO). Omit jobOrderId for all.
export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    const params = new URL(request.url).searchParams;
    const groups = await getDeliveryReceiptService().listDeliverable(actor, {
      jobOrderId: params.get("jobOrderId") ?? undefined,
      q: params.get("q") ?? undefined,
    });
    return NextResponse.json(ok(groups));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
