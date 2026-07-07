import type { Metadata } from "next";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Dashboard" };

const kpis = [
  { title: "Pending Quotations", hint: "Awaiting approval or reply" },
  { title: "Active Job Orders", hint: "In production" },
  { title: "Sales This Month", hint: "Invoiced amount" },
  { title: "Unresolved Audit Flags", hint: "Needs auditor action" },
];

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="Dashboard"
        description="KPIs and charts land here in Phase 6 — powered by Prisma aggregations."
        badge="Phase 6"
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <Card key={kpi.title}>
            <CardHeader className="pb-2">
              <CardDescription>{kpi.title}</CardDescription>
              <CardTitle className="text-3xl tabular-nums">—</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              {kpi.hint}
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
