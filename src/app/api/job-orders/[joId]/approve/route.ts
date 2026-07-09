import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok, ValidationError } from "@/lib/errors";
import { getJobOrderService } from "@/modules/job-orders/services";

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_FILES = 10;

// POST /api/job-orders/:joId/approve — multipart files[] proving the customer
// approved; marks isApprovedByCustomer. A Route Handler because of the files.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ joId: string }> }
) {
  try {
    const actor = await requireActor();
    const { joId } = await params;

    const form = await request.formData();
    const entries = form.getAll("files").filter((f): f is File => f instanceof File);
    if (entries.length > MAX_FILES) {
      throw new ValidationError(`Attach at most ${MAX_FILES} files.`);
    }
    const files = [];
    for (const file of entries) {
      if (file.size === 0) continue;
      if (file.size > MAX_FILE_BYTES) {
        throw new ValidationError(`"${file.name}" is too large (max 15 MB).`);
      }
      files.push({
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        data: new Uint8Array(await file.arrayBuffer()),
      });
    }

    await getJobOrderService().approveByCustomer(actor, joId, files);
    return NextResponse.json(ok(null));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
