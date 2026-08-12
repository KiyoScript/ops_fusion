import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PencilIcon } from "lucide-react";
import { requireActor } from "@/lib/authz";
import { defineAbilityFor } from "@/lib/ability";
import { NotFoundError } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { BackButton } from "@/components/back-button";
import { getCompanyService } from "@/modules/customers/services/company-service";
import { CompanyDetailView } from "@/modules/customers/components/company-detail-view";
import type { CompanyDetailDto } from "@/modules/customers/schemas/company";

export const metadata: Metadata = { title: "Company" };

export default async function CompanyProfilePage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const actor = await requireActor();
  const { companyId } = await params;
  const canEdit = defineAbilityFor(actor).can("update", "Customer");

  let company: CompanyDetailDto;
  try {
    company = await getCompanyService().getDetail(actor, companyId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }

  return (
    <>
      <BackButton fallbackHref="/customers" label="Customers" />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title={company.name} description="Company profile — billing, contact persons, and documents." />
        {canEdit && (
          <Button variant="outline" nativeButton={false} render={<Link href={`/customers/companies/${company.id}/edit`} />}>
            <PencilIcon /> Edit company
          </Button>
        )}
      </div>
      <CompanyDetailView company={company} canEdit={canEdit} />
    </>
  );
}
