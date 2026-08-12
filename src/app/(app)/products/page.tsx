import type { Metadata } from "next";
import { requireActor } from "@/lib/authz";
import { defineAbilityFor } from "@/lib/ability";
import { Role } from "@/generated/prisma/enums";
import { PageHeader } from "@/components/page-header";
import { PriceListWorkbench } from "@/modules/quotations/components/price-list-workbench";

export const metadata: Metadata = { title: "Products & Services" };

export default async function ProductsPage() {
  const actor = await requireActor();
  const ability = defineAbilityFor(actor);

  return (
    <>
      <PageHeader
        title="Products & Services"
        description="The shared product catalog behind quotation and job order line items — add products and edit their variants, quantity tiers, and add-ons, or import the whole workbook."
      />
      <PriceListWorkbench
        canMaintain={ability.can("maintain", "Maintenance")}
        canRemoveAll={actor.role === Role.ADMIN}
      />
    </>
  );
}
