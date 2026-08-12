import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/authz";
import { defineAbilityFor } from "@/lib/ability";
import { PageHeader } from "@/components/page-header";
import { BackButton } from "@/components/back-button";
import { getCreditTermService } from "@/modules/customers/services/credit-term-service";
import { getCompanyService } from "@/modules/customers/services/company-service";
import { CustomerCreateForm } from "@/modules/customers/components/customer-create-form";

export const metadata: Metadata = { title: "New Customer" };

export default async function NewCustomerPage({
  searchParams,
}: {
  searchParams: Promise<{ companyId?: string }>;
}) {
  const actor = await requireActor();
  if (defineAbilityFor(actor).cannot("create", "Customer")) {
    redirect("/customers");
  }
  const creditTerms = await getCreditTermService().listActiveDays();
  const { companyId } = await searchParams;
  const initialCompany = companyId
    ? await getCompanyService().getPicker(actor, companyId)
    : null;

  return (
    <>
      <BackButton fallbackHref={initialCompany ? `/customers/companies/${initialCompany.id}` : "/customers"} label={initialCompany ? initialCompany.name : "Customers"} />
      <PageHeader
        title={initialCompany ? `Add a contact to ${initialCompany.name}` : "New customer"}
        description={
          initialCompany
            ? "This person joins the company as a contact — the company's billing is reused."
            : "Add a company (with its first contact person) or a non-company individual."
        }
      />
      <CustomerCreateForm creditTerms={creditTerms} initialCompany={initialCompany} />
    </>
  );
}
