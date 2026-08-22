import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok } from "@/lib/errors";
import { getReceiptService } from "@/modules/sales-audit/services";

// GET /api/job-orders/:joId/receipts — every document ever raised against this
// job, in order, with what was still owed after each. (Folder slug is `joId` to
// match the other job-orders routes — Next.js forbids mixed slug names at the
// same path level; the public URL is unchanged.)
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ joId: string }> }
) {
  try {
    const actor = await requireActor();
    const { joId } = await params;
    const history = await getReceiptService().getJobOrderHistory(actor, joId);
    return NextResponse.json(ok(history));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
