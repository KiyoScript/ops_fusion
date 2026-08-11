import type { Metadata } from "next";
import { requireActor } from "@/lib/authz";
import { PageHeader } from "@/components/page-header";
import { CustomersView } from "@/modules/customers/components/customers-view";

export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage() {
  await requireActor();
  return (
    <>
      <PageHeader
        title="Customers"
        description="The shared customer master — created from the Quotation flow. Search and open a customer for their full details and document history."
      />
      <CustomersView />
    </>
  );
}
