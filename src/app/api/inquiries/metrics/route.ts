import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok } from "@/lib/errors";
import { getInquiryService } from "@/modules/quotations/services";

// GET /api/inquiries/metrics — counts by status + medium for the dashboard.
export async function GET() {
  try {
    await requireActor();
    const metrics = await getInquiryService().metrics();
    return NextResponse.json(ok(metrics));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
