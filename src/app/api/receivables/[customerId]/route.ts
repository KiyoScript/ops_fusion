import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok, ValidationError } from "@/lib/errors";
import { getReceivableService } from "@/modules/sales-audit/services";
import { setCreditInput } from "@/modules/sales-audit/schemas/receipt";

// GET /api/receivables/:customerId?asOf=YYYY-MM-DD — one customer's Statement
// of Account. `asOf` rewinds it: what they owed at that date, aged to it.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ customerId: string }> }
) {
  try {
    const actor = await requireActor();
    const { customerId } = await params;
    const asOf = new URL(request.url).searchParams.get("asOf");
    if (asOf && !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
      throw new ValidationError("Use a YYYY-MM-DD date.");
    }
    const statement = await getReceivableService().statement(
      actor,
      customerId,
      asOf ?? undefined
    );
    return NextResponse.json(ok(statement));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}

// PATCH /api/receivables/:customerId — set this customer's credit terms.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ customerId: string }> }
) {
  try {
    const actor = await requireActor();
    const { customerId } = await params;
    const parsed = setCreditInput.safeParse({
      ...(await request.json()),
      customerId,
    });
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Invalid credit terms."
      );
    }
    const customer = await getReceivableService().setCredit(actor, parsed.data);
    return NextResponse.json(ok(customer));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
