import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/authz";
import { defineAbilityFor } from "@/lib/ability";
import { PageHeader } from "@/components/page-header";
import { getPriceListService } from "@/modules/quotations/services";
import { AddonsMaintenanceView } from "@/modules/quotations/components/addons-maintenance-view";

export const metadata: Metadata = { title: "Add-ons" };

export default async function AddonsMaintenancePage() {
  const actor = await requireActor();
  const ability = defineAbilityFor(actor);
  if (ability.cannot("maintain", "Maintenance")) {
    redirect("/quotations");
  }
  const addons = await getPriceListService().listGlobalAddons();

  return (
    <>
      <PageHeader
        title="Add-ons"
        description="Common fees (rush, design, delivery…) offered on every product — set whether each applies per line item or once for the whole JO."
      />
      <AddonsMaintenanceView addons={addons} canMaintain={ability.can("maintain", "Maintenance")} />
    </>
  );
}
