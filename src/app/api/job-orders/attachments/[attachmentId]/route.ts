import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail } from "@/lib/errors";
import { getJobOrderService } from "@/modules/job-orders/services";

// GET /api/job-orders/attachments/:attachmentId — proof-file download.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ attachmentId: string }> }
) {
  try {
    const actor = await requireActor();
    const { attachmentId } = await params;
    const file = await getJobOrderService().getAttachment(actor, attachmentId);
    return new NextResponse(Buffer.from(file.data), {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Disposition": `inline; filename="${file.fileName.replace(/[^\w.-]+/g, "_")}"`,
      },
    });
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
