import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok, ValidationError } from "@/lib/errors";
import { getReceivableService } from "@/modules/sales-audit/services";
import { setWithholdingInput } from "@/modules/sales-audit/schemas/receipt";

// PATCH /api/receivables/:customerId/withholding — mark this customer as a
// BIR withholding agent and set the rate the counter should suggest.
//
// Its own route rather than a field on the credit PATCH: the service gates it
// on `maintain Maintenance` (R8) and logs its own ActivityLog action (R12),
// because changing a withholding rate changes what every future collection
// deducts from what the customer owes.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ customerId: string }> }
) {
  try {
    const actor = await requireActor();
    const { customerId } = await params;
    const parsed = setWithholdingInput.safeParse({
      ...(await request.json()),
      customerId,
    });
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Invalid withholding settings."
      );
    }
    const customer = await getReceivableService().setWithholding(
      actor,
      parsed.data
    );
    return NextResponse.json(ok(customer));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
