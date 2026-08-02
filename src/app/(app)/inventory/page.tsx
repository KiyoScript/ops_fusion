import type { Metadata } from "next";
import { requireActor } from "@/lib/authz";
import { defineAbilityFor } from "@/lib/ability";
import { PageHeader } from "@/components/page-header";
import { InventoryView } from "@/modules/inventory/components/inventory-view";

export const metadata: Metadata = { title: "Inventory" };

export default async function InventoryPage() {
  const ability = defineAbilityFor(await requireActor());
  return (
    <>
      <PageHeader
        title="Inventory & Materials"
        description="Item master, ledger-derived stock, adjustments, cycle counts, and reorder alerts."
      />
      <InventoryView
        canMaintainMaterial={ability.can("maintain", "Material")}
        canCreateStockOps={ability.can("create", "StockAdjustment")}
        canApprove={ability.can("approve", "StockAdjustment")}
        canCreateMr={ability.can("create", "MaterialRequest")}
        canApproveMr={ability.can("approve", "MaterialRequest")}
        canReleaseMr={ability.can("release", "MaterialRequest")}
      />
    </>
  );
}
