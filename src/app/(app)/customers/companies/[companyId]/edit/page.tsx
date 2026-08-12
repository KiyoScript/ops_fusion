import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireActor } from "@/lib/authz";
import { defineAbilityFor } from "@/lib/ability";
import { NotFoundError } from "@/lib/errors";
import { PageHeader } from "@/components/page-header";
import { BackButton } from "@/components/back-button";
import { getCompanyService } from "@/modules/customers/services/company-service";
import { getCreditTermService } from "@/modules/customers/services/credit-term-service";
import { CompanyEditForm } from "@/modules/customers/components/company-edit-form";
import type { CompanyDetailDto } from "@/modules/customers/schemas/company";

export const metadata: Metadata = { title: "Edit Company" };

export default async function CompanyEditPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const actor = await requireActor();
  const { companyId } = await params;
  if (defineAbilityFor(actor).cannot("update", "Customer")) {
    redirect(`/customers/companies/${companyId}`);
  }

  let company: CompanyDetailDto;
  try {
    company = await getCompanyService().getDetail(actor, companyId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const creditTerms = await getCreditTermService().listActiveDays();

  return (
    <>
      <BackButton fallbackHref={`/customers/companies/${companyId}`} label="Company" />
      <PageHeader title={`Edit ${company.name}`} description="Company billing — changes sync to all its contact persons." />
      <CompanyEditForm company={company} creditTerms={creditTerms} />
    </>
  );
}
