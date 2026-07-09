import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/authz";
import { getLookupService } from "@/modules/shared/services/lookup-service";
import { getEmployeeService } from "@/modules/shared/services/employee-service";
import { PageHeader } from "@/components/page-header";
import { LookupManager } from "@/modules/shared/components/lookup-manager";
import { EmployeeManager } from "@/modules/shared/components/employee-manager";

export const metadata: Metadata = { title: "JO Maintenance" };

export default async function JoMaintenancePage() {
  const actor = await requireActor();
  if (actor.role !== "ADMIN" && actor.role !== "MANAGER") {
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
      <div className="grid gap-6 xl:grid-cols-2">
        <LookupManager
          type="JO_STATUS"
          title="Production statuses"
          description={`"Status - Department" values. Statuses containing done/completed/delivered/finished/closed auto-archive an item; "pick up / delivery" statuses mark it waiting.`}
          items={statuses}
        />
        <LookupManager
          type="JO_CATEGORY"
          title="Service categories"
          description={`Item categories (legacy OPSServices). The "Sales - " prefix is stripped on import; categories marked LFP auto-tick the large-format flag when picked on a JO item.`}
          items={categories}
          withLFP
          importConfig={{
            url: "/api/lookups/import-categories",
            hint: "Or import the OPSServices sheet (.xlsx or .csv):",
          }}
        />
        <EmployeeManager items={employees} />
      </div>
    </>
  );
}
