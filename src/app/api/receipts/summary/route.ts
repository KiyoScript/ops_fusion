import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok } from "@/lib/errors";
import { getReceiptService } from "@/modules/sales-audit/services";

// GET /api/receipts/summary?date=YYYY-MM-DD — the day's VAT / Non-VAT totals.
export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    const date = new URL(request.url).searchParams.get("date") ?? undefined;
    const summary = await getReceiptService().getDailySummary(actor, date);
    return NextResponse.json(ok(summary));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
