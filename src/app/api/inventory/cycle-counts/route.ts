import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok, ValidationError } from "@/lib/errors";
import { getCycleCountService } from "@/modules/inventory/services/cycle-count-service";
import { cycleCountListFilters } from "@/modules/inventory/schemas/stock";

// GET /api/inventory/cycle-counts?q=&status=&cursor=&take= — cycle count list.
export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const parsed = cycleCountListFilters.safeParse(params);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Invalid filters."
      );
    }
    const page = await getCycleCountService().list(actor, parsed.data);
    return NextResponse.json(ok(page));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
