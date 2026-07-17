import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/authz";
import { defineAbilityFor } from "@/lib/ability";
import { Role } from "@/generated/prisma/enums";
import { PageHeader } from "@/components/page-header";
import { PriceListWorkbench } from "@/modules/quotations/components/price-list-workbench";

export const metadata: Metadata = { title: "Quotation Maintenance" };

export default async function QuotationMaintenancePage() {
  const actor = await requireActor();
  const ability = defineAbilityFor(actor);
  if (ability.cannot("read", "Maintenance")) redirect("/quotations");

  return (
    <>
      <PageHeader
        title="Quotation Maintenance"
        description="The price database behind the quote form — one tab per product, like the SignQuote spreadsheet. Edit prices inline and Save, or import the whole workbook."
      />
      <PriceListWorkbench
        canMaintain={ability.can("maintain", "Maintenance")}
        canRemoveAll={actor.role === Role.ADMIN}
      />
    </>
  );
}
