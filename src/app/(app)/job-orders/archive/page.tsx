import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/authz";
import { getJobOrderService } from "@/modules/job-orders/services";
import { PageHeader } from "@/components/page-header";
import { ArchiveView } from "@/modules/job-orders/components/archive-view";

export const metadata: Metadata = { title: "Archive JOs" };

export default async function ArchiveJosPage() {
  const actor = await requireActor();
  // Legacy rule: the archive is admin-only.
  if (actor.role !== "ADMIN") redirect("/job-orders");

  await getJobOrderService().logArchiveView(actor); // legacy ARCHIVE_VIEW audit

  return (
    <>
      <PageHeader
        title="Archive JOs"
        description="Archived line items — done work and archived JOs, most recent first. Read-only."
      />
      <ArchiveView />
    </>
  );
}
