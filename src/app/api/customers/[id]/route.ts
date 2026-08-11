import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok } from "@/lib/errors";
import { getCustomerDirectoryService } from "@/modules/customers/services/customer-directory-service";

// GET /api/customers/:id — full customer master detail + document footprint.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireActor();
    const { id } = await params;
    const customer = await getCustomerDirectoryService().get(actor, id);
    return NextResponse.json(ok(customer));
  } catch (err) {
    return NextResponse.json(fail(err), { status: err instanceof AppError ? err.status : 500 });
  }
}
