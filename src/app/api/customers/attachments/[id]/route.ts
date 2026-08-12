import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { getCompanyService } from "@/modules/customers/services/company-service";

// GET /api/customers/attachments/[id] — stream a profile document (Credit
// Request / BIR 2303 / …). Any authenticated user who can reach the profile.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireActor();
  const { id } = await params;
  const file = await getCompanyService().getAttachmentFile(id);
  if (!file) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(Buffer.from(file.data), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Disposition": `inline; filename="${encodeURIComponent(file.fileName)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
