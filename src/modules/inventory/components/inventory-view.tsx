"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MaterialsTab } from "./materials-tab";
import { AdjustmentsTab } from "./adjustments-tab";
import { CycleCountsTab } from "./cycle-counts-tab";
import { ReorderTab } from "./reorder-tab";

export function InventoryView({
  canMaintainMaterial,
  canCreateStockOps,
  canApprove,
}: {
  canMaintainMaterial: boolean;
  canCreateStockOps: boolean;
  canApprove: boolean;
}) {
  return (
    <Tabs defaultValue="items">
      <TabsList>
        <TabsTrigger value="items">Items</TabsTrigger>
        <TabsTrigger value="adjustments">Adjustments</TabsTrigger>
        <TabsTrigger value="counts">Cycle counts</TabsTrigger>
        <TabsTrigger value="reorder">Reorder</TabsTrigger>
      </TabsList>

      <TabsContent value="items">
        <MaterialsTab canMaintain={canMaintainMaterial} />
      </TabsContent>
      <TabsContent value="adjustments">
        <AdjustmentsTab canCreate={canCreateStockOps} canApprove={canApprove} />
      </TabsContent>
      <TabsContent value="counts">
        <CycleCountsTab canCreate={canCreateStockOps} canApprove={canApprove} />
      </TabsContent>
      <TabsContent value="reorder">
        <ReorderTab />
      </TabsContent>
    </Tabs>
  );
}
