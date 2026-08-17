import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireActor } from "@/lib/authz";
import { defineAbilityFor } from "@/lib/ability";
import { NotFoundError } from "@/lib/errors";
import { PageHeader } from "@/components/page-header";
import { BackButton } from "@/components/back-button";
import { getCustomerDirectoryService } from "@/modules/customers/services/customer-directory-service";
import { CustomerDetailView } from "@/modules/customers/components/customer-detail-view";
import { CustomerArPanel } from "@/modules/sales-audit/components/customer-ar-panel";
import type { CustomerDetailDto } from "@/modules/customers/schemas/customer";

export const metadata: Metadata = { title: "Customer" };

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const actor = await requireActor();
  const { customerId } = await params;

  let detail: CustomerDetailDto;
  try {
    detail = await getCustomerDirectoryService().get(actor, customerId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }

  const canEdit = defineAbilityFor(actor).can("update", "Customer");

  return (
    <>
      <BackButton fallbackHref="/customers" label="Customers" />
      <PageHeader title={detail.name} description={detail.company || "Customer master record"} />
      {/* Owned by the finance track (src/modules/sales-audit) — it reads the
          one definition of what a customer owes rather than recomputing it
          here. Renders nothing when the customer has no balance and no credit,
          or when the receivables module is switched off. */}
      <CustomerArPanel actor={actor} customerId={customerId} />
      <CustomerDetailView customer={detail} canEdit={canEdit} />
    </>
  );
}
