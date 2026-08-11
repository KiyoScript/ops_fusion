import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok, ValidationError } from "@/lib/errors";
import { getCustomerDirectoryService } from "@/modules/customers/services/customer-directory-service";
import { customerListFilters } from "@/modules/customers/schemas/customer";

// GET /api/customers/list?q=&customerType=&cursor=&take= — paginated customer
// directory with full master fields + document counts.
export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const parsed = customerListFilters.safeParse(params);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid filters.");
    }
    const page = await getCustomerDirectoryService().list(actor, parsed.data);
    return NextResponse.json(ok(page));
  } catch (err) {
    return NextResponse.json(fail(err), { status: err instanceof AppError ? err.status : 500 });
  }
}
