import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/authz";
import { defineAbilityFor } from "@/lib/ability";
import { PageHeader } from "@/components/page-header";
import { SuppliersView } from "@/modules/inventory/components/suppliers-view";

export const metadata: Metadata = { title: "Inventory Maintenance" };

export default async function InventoryMaintenancePage() {
  const actor = await requireActor();
  const ability = defineAbilityFor(actor);
  if (ability.cannot("maintain", "Supplier")) {
    redirect("/inventory");
  }

  return (
    <>
      <PageHeader
        title="Inventory Maintenance"
        description="Suppliers — the master data behind items and (later) purchase orders. The new home of the legacy Supplier sheet."
      />
      <SuppliersView canMaintain={ability.can("maintain", "Supplier")} />
    </>
  );
}
