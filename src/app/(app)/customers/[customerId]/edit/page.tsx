import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireActor } from "@/lib/authz";
import { defineAbilityFor } from "@/lib/ability";
import { NotFoundError } from "@/lib/errors";
import { PageHeader } from "@/components/page-header";
import { BackButton } from "@/components/back-button";
import { getCustomerDirectoryService } from "@/modules/customers/services/customer-directory-service";
import { CustomerEditForm } from "@/modules/customers/components/customer-edit-form";
import type { CustomerEditDto } from "@/modules/customers/schemas/customer";

export const metadata: Metadata = { title: "Edit Customer" };

export default async function CustomerEditPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const actor = await requireActor();
  const { customerId } = await params;

  if (defineAbilityFor(actor).cannot("update", "Customer")) {
    redirect(`/customers/${customerId}`);
  }

  let customer: CustomerEditDto;
  try {
    customer = await getCustomerDirectoryService().getForEdit(actor, customerId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }

  return (
    <>
      <BackButton fallbackHref={`/customers/${customerId}`} label="Customer" />
      <PageHeader title={`Edit ${customer.name}`} description="Update the customer master record." />
      <CustomerEditForm customer={customer} />
    </>
  );
}
