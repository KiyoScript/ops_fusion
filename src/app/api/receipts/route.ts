import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok, ValidationError } from "@/lib/errors";
import { getReceiptService } from "@/modules/sales-audit/services";
import {
  receiptListFilters,
  receivePaymentInput,
} from "@/modules/sales-audit/schemas/receipt";

// GET /api/receipts?date=YYYY-MM-DD&q= — the daily sales log.
export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const parsed = receiptListFilters.safeParse(params);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Invalid filters."
      );
    }
    const page = await getReceiptService().listDay(actor, parsed.data);
    return NextResponse.json(ok(page));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}

// POST /api/receipts — Receive Payment: issue a receipt and take the money.
export async function POST(request: Request) {
  try {
    const actor = await requireActor();
    const parsed = receivePaymentInput.safeParse(await request.json());
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Invalid payment."
      );
    }
    const receipt = await getReceiptService().receivePayment(actor, parsed.data);
    return NextResponse.json(ok(receipt));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
