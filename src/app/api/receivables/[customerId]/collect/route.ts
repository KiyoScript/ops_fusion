import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok, ValidationError } from "@/lib/errors";
import { getReceiptService } from "@/modules/sales-audit/services";
import { collectFromCustomerInput } from "@/modules/sales-audit/schemas/receipt";

// GET /api/receivables/:customerId/collect — what the Collect dialog opens
// with: open invoices across every job order, plus credit held on account.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ customerId: string }> }
) {
  try {
    const actor = await requireActor();
    const { customerId } = await params;
    const options = await getReceiptService().getCollectOptions(actor, customerId);
    return NextResponse.json(ok(options));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}

// POST /api/receivables/:customerId/collect — take a payment against the
// customer's account, applied across their open invoices.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ customerId: string }> }
) {
  try {
    const actor = await requireActor();
    const { customerId } = await params;
    const parsed = collectFromCustomerInput.safeParse({
      ...(await request.json()),
      customerId,
    });
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Invalid payment."
      );
    }
    const result = await getReceiptService().collectFromCustomer(
      actor,
      parsed.data
    );
    return NextResponse.json(ok(result));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
