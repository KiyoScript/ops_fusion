import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok, ValidationError } from "@/lib/errors";
import { getReceiptService } from "@/modules/sales-audit/services";
import {
  replaceReceiptInput,
  voidReceiptInput,
} from "@/modules/sales-audit/schemas/receipt";

// POST /api/receipts/void — cancel, void, or replace an issued receipt.
//
// Replacing is a different shape from cancelling (it carries the corrected
// receipt with it) and must happen in ONE transaction, so the two share a
// route and are told apart by the presence of `replacement`.
export async function POST(request: Request) {
  try {
    const actor = await requireActor();
    const body = await request.json();
    const service = getReceiptService();

    if (body && typeof body === "object" && "replacement" in body) {
      const parsed = replaceReceiptInput.safeParse(body);
      if (!parsed.success) {
        throw new ValidationError(
          parsed.error.issues[0]?.message ?? "Invalid replacement."
        );
      }
      return NextResponse.json(ok(await service.replaceReceipt(actor, parsed.data)));
    }

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
