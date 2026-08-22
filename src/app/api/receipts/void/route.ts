import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok, ValidationError } from "@/lib/errors";
import { getReceiptService } from "@/modules/sales-audit/services";
import { voidReceiptInput } from "@/modules/sales-audit/schemas/receipt";

// POST /api/receipts/void — cancel an issued receipt.
export async function POST(request: Request) {
  try {
    const actor = await requireActor();
    const body = await request.json();
    const service = getReceiptService();

    const parsed = voidReceiptInput.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Invalid cancellation."
      );
    }
    return NextResponse.json(ok(await service.voidReceipt(actor, parsed.data)));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
