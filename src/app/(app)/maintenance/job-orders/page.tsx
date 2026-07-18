import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/authz";
import { defineAbilityFor } from "@/lib/ability";
import { getLookupService } from "@/modules/shared/services/lookup-service";
import { getEmployeeService } from "@/modules/shared/services/employee-service";
import { PageHeader } from "@/components/page-header";
import { JoMaintenanceTabs } from "@/modules/job-orders/components/jo-maintenance-tabs";

export const metadata: Metadata = { title: "JO Maintenance" };

export default async function JoMaintenancePage() {
  const actor = await requireActor();
  if (defineAbilityFor(actor).cannot("maintain", "Maintenance")) {
    redirect("/job-orders");
  }

  const lookups = getLookupService();
  const [statuses, categories, employees] = await Promise.all([
    lookups.list(actor, "JO_STATUS", true),
    lookups.list(actor, "JO_CATEGORY", true),
    getEmployeeService().list(actor, true),
  ]);

  return (
    <>
      <PageHeader
        title="Job Order Maintenance"
        description="The reference lists behind the JO dropdowns — the new home of the legacy Status Department, Employee, and OPS Services sheets."
      />
      <JoMaintenanceTabs
        statuses={statuses}
        categories={categories}
        employees={employees}
      />
    </>
  );
}
