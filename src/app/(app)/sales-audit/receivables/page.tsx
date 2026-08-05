import type { Metadata } from "next";
import { requireActor } from "@/lib/authz";
import { defineAbilityFor } from "@/lib/ability";
import { PageHeader } from "@/components/page-header";
import { ReceivablesView } from "@/modules/sales-audit/components/receivables-view";

export const metadata: Metadata = { title: "Receivables" };

export default async function ReceivablesPage() {
  // The route guard in (app)/layout.tsx already blocks this page when the
  // `receivables` module is switched off; this only enforces sign-in.
  const ability = defineAbilityFor(await requireActor());

  return (
    <>
      <PageHeader
        title="Accounts Receivable"
        description="What customers still owe on invoices already issued — charge invoices awaiting a Collection Receipt, aged by how long they have been due."
      />
      <ReceivablesView canMaintain={ability.can("maintain", "Maintenance")} />
    </>
  );
}
