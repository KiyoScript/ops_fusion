import type { Metadata } from "next";
import Link from "next/link";
import { PlusIcon } from "lucide-react";
import { requireActor } from "@/lib/authz";
import { defineAbilityFor } from "@/lib/ability";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { getCustomerDirectoryService } from "@/modules/customers/services/customer-directory-service";
import { CustomerMetricsCards } from "@/modules/customers/components/customer-metrics-cards";
import { CustomersDirectory } from "@/modules/customers/components/customers-directory";

export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage() {
  const actor = await requireActor();
  const canCreate = defineAbilityFor(actor).can("create", "Customer");
  const metrics = await getCustomerDirectoryService().getMetrics(actor);
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="Customers"
          description="Companies (with their contact persons) and non-company individuals — kept in separate tabs. Open one for its dashboard and full document history."
        />
        {canCreate && (
          <Button nativeButton={false} render={<Link href="/customers/new" />}>
            <PlusIcon /> New customer
          </Button>
        )}
      </div>
      <CustomerMetricsCards m={metrics} />
      <CustomersDirectory individuals={metrics.individuals} companies={metrics.companies} />
    </>
  );
}
