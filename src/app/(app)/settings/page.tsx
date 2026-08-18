import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/authz";
import { defineAbilityFor } from "@/lib/ability";
import { getModuleFlagService } from "@/modules/shared/services/module-flag-service";
import { PageHeader } from "@/components/page-header";
import { ModuleFlagsManager } from "@/modules/shared/components/module-flags-manager";
import { SignatureUpload } from "@/modules/shared/components/signature-upload";
import { getCompanyProfile } from "@/lib/company-profile";
import { getCreditTermService } from "@/modules/customers/services/credit-term-service";
import { CreditTermsManager } from "@/modules/customers/components/credit-terms-manager";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const actor = await requireActor();
  // Feature flags are powerful — admin only. Non-admins get bounced.
  if (defineAbilityFor(actor).cannot("update", "ModuleFlag")) {
    redirect("/");
  }

  const modules = await getModuleFlagService().list();
  const profile = await getCompanyProfile();
  const creditTerms = await getCreditTermService().list(actor, true);

  return (
    <>
      <PageHeader
        title="Settings"
        description="System configuration. Users, roles, and booklet maintenance land here in later phases."
      />
      <div className="grid gap-6">
        <ModuleFlagsManager modules={modules} />
        <div className="max-w-xl">
          <CreditTermsManager terms={creditTerms} />
        </div>
        <SignatureUpload profile={profile} />
      </div>
    </>
  );
}
