import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok } from "@/lib/errors";
import { getJobOrderService } from "@/modules/job-orders/services";
import { reportDateInput } from "@/modules/job-orders/schemas/job-order";

// GET /api/job-orders/reports?asOf=yyyy-MM-dd — EOD stats + dept report rows.
export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const parsed = reportDateInput.safeParse(params);
    const asOf = parsed.success ? parsed.data.asOf : undefined;

    const service = getJobOrderService();
    const [eod, rows] = await Promise.all([
      service.getEodReport(actor, asOf),
      service.getReportRows(),
    ]);
    return NextResponse.json(ok({ eod, rows }));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
