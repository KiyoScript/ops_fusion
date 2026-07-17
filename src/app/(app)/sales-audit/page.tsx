import type { Metadata } from "next";
import { requireActor } from "@/lib/authz";
import { defineAbilityFor } from "@/lib/ability";
import { PageHeader } from "@/components/page-header";
import { DailySalesView } from "@/modules/sales-audit/components/daily-sales-view";

export const metadata: Metadata = { title: "Sales Audit" };

export default async function SalesAuditPage() {
  const ability = defineAbilityFor(await requireActor());
  const canAudit = ability.can("audit", "Sale");

  return (
    <>
      <PageHeader
        title="Sales Audit"
        description="The day's receipts — Job Order receipts, Sales Invoices (VAT and Non-VAT), and Collection Receipts — with the auditor's sign-off."
      />
      <DailySalesView canAudit={canAudit} />
    </>
  );
}
