import type { Metadata } from "next";
import { requireActor } from "@/lib/authz";
import { PageHeader } from "@/components/page-header";
import { PipelineView } from "@/modules/sales-audit/components/pipeline-view";

export const metadata: Metadata = { title: "Unbilled & Backlog" };

export default async function PipelinePage() {
  await requireActor();

  return (
    <>
      <PageHeader
        title="Unbilled & Backlog"
        description="Work that is owed to us but is not on the A/R ledger — still on the shop floor, or delivered and never invoiced. The second one is money already earned that nobody is chasing."
      />
      <PipelineView />
    </>
  );
}
