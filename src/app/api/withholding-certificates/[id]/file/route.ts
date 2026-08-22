import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok, ValidationError } from "@/lib/errors";
import { getWithholdingService } from "@/modules/sales-audit/services";

// GET /api/withholding-certificates/:id/file — the scanned form.
//
// Gated through the service rather than streamed straight from the id, so the
// same `read WithholdingCertificate` check covers the image as covers the row.
// The scan IS the evidence for the tax credit; it is no less confidential than
// the record pointing at it.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireActor();
    const { id } = await params;
    const file = await getWithholdingService().readFile(actor, id);
    return new NextResponse(Buffer.from(file.fileData), {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Disposition": `inline; filename="${encodeURIComponent(file.fileName)}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}

// POST /api/withholding-certificates/:id/file — attach the scan.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireActor();
    const { id } = await params;
    const form = await request.formData();
    const upload = form.get("file");
    if (!(upload instanceof File)) {
      throw new ValidationError("Choose a file to attach.");
    }
    const saved = await getWithholdingService().attachFile(actor, id, {
      fileName: upload.name,
      mimeType: upload.type,
      fileData: new Uint8Array(await upload.arrayBuffer()),
    });
    return NextResponse.json(ok(saved));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
