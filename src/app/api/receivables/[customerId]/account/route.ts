import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok } from "@/lib/errors";
import { getReceivableService } from "@/modules/sales-audit/services";

// GET /api/receivables/:customerId/account — one customer's whole account:
// open invoices, credit held for them, and their payment history.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ customerId: string }> }
) {
  try {
    const actor = await requireActor();
    const { customerId } = await params;
    const account = await getReceivableService().account(actor, customerId);
    return NextResponse.json(ok(account));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
