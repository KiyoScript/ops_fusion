"use client";

import { useQueryState } from "nuqs";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LookupManager } from "@/modules/shared/components/lookup-manager";
import { EmployeeManager } from "@/modules/shared/components/employee-manager";
import type { LookupDto } from "@/modules/shared/schemas/lookup";
import type { EmployeeDto } from "@/modules/shared/schemas/employee";

/** JO Maintenance as one-section-per-tab (ruling 2026-07-17): each reference
 *  list gets its own tab. Service categories moved to Products & Services (LFP
 *  is a product attribute now) and the production workflow is a fixed standard
 *  in code, so only statuses and employees remain here. The active tab lives in
 *  the URL (?tab=…) so links land on the right one. */
export function JoMaintenanceTabs({
  statuses,
  employees,
}: {
  statuses: LookupDto[];
  employees: EmployeeDto[];
}) {
  const [tab, setTab] = useQueryState("tab", { defaultValue: "statuses" });

  return (
    <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
      <TabsList>
        <TabsTrigger value="statuses">Production statuses</TabsTrigger>
        <TabsTrigger value="employees">Employees</TabsTrigger>
      </TabsList>

      <TabsContent value="statuses">
        <LookupManager
          type="JO_STATUS"
          title="Production statuses"
          description={`"Status - Department" values. Statuses containing done/completed/delivered/finished/closed auto-archive an item; "pick up / delivery" statuses mark it waiting.`}
          items={statuses}
        />
      </TabsContent>

      <TabsContent value="employees">
        <EmployeeManager items={employees} />
      </TabsContent>
    </Tabs>
  );
}
