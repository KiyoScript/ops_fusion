import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok } from "@/lib/errors";
import { getDeliveryReceiptService } from "@/modules/delivery-receipts/services";

// GET /api/delivery-receipts/:drId — full DR detail.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ drId: string }> }
) {
  try {
    const actor = await requireActor();
    const { drId } = await params;
    const dr = await getDeliveryReceiptService().get(actor, drId);
    return NextResponse.json(ok(dr));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
