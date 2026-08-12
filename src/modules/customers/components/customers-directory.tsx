"use client";

import { useQueryState } from "nuqs";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CustomersView } from "./customers-view";
import { CompaniesView } from "./companies-view";

/** Customers directory split into Individuals (non-company customers) and
 *  Companies (billed entities → their contact persons), so search and reading
 *  don't mix the two. */
export function CustomersDirectory({
  individuals,
  companies,
}: {
  individuals: number;
  companies: number;
}) {
  const [tab, setTab] = useQueryState("tab", { defaultValue: "individuals" });
  return (
    <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
      <TabsList>
        <TabsTrigger value="individuals">Individuals ({individuals})</TabsTrigger>
        <TabsTrigger value="companies">Companies ({companies})</TabsTrigger>
      </TabsList>
      <TabsContent value="individuals" className="pt-3">
        <CustomersView individualsOnly />
      </TabsContent>
      <TabsContent value="companies" className="pt-3">
        <CompaniesView />
      </TabsContent>
    </Tabs>
  );
}
