import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/authz";
import { defineAbilityFor } from "@/lib/ability";
import { getJobOrderService } from "@/modules/job-orders/services";
import { PageHeader } from "@/components/page-header";
import { TransactionsView } from "@/modules/job-orders/components/transactions-view";

export const metadata: Metadata = { title: "Transactions History" };

export default async function TransactionsPage() {
  const actor = await requireActor();
  // Legacy rule (inherited from the Archive page this replaces): admin-only.
  if (defineAbilityFor(actor).cannot("read", "Archive")) redirect("/job-orders");

  await getJobOrderService().logArchiveView(actor); // legacy ARCHIVE_VIEW audit

  return (
    <>
      <PageHeader
        title="Transactions History"
        description="Every job order — filter by date, payment, delivery, production, customer or type. Read-only."
      />
      <TransactionsView />
    </>
  );
}
