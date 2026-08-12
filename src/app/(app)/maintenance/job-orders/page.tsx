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

  const [statuses, employees] = await Promise.all([
    getLookupService().list(actor, "JO_STATUS", true),
    getEmployeeService().list(actor, true),
  ]);

  return (
    <>
      <PageHeader
        title="Job Order Maintenance"
        description="The reference lists behind the JO dropdowns — production statuses (legacy Status Department) and the employee roster."
      />
      <JoMaintenanceTabs statuses={statuses} employees={employees} />
    </>
  );
}
