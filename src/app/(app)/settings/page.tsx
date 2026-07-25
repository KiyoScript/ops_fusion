import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/authz";
import { defineAbilityFor } from "@/lib/ability";
import { getModuleFlagService } from "@/modules/shared/services/module-flag-service";
import { PageHeader } from "@/components/page-header";
import { ModuleFlagsManager } from "@/modules/shared/components/module-flags-manager";
import { SignatureUpload } from "@/modules/shared/components/signature-upload";
import { getCompanyProfile } from "@/lib/company-profile";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const actor = await requireActor();
  // Feature flags are powerful — admin only. Non-admins get bounced.
  if (defineAbilityFor(actor).cannot("update", "ModuleFlag")) {
    redirect("/");
  }

  const modules = await getModuleFlagService().list();
  const profile = await getCompanyProfile();

  return (
    <>
      <PageHeader
        title="Settings"
        description="System configuration. Users, roles, and booklet maintenance land here in later phases."
      />
      <div className="grid gap-6">
        <ModuleFlagsManager modules={modules} />
        <SignatureUpload profile={profile} />
      </div>
    </>
  );
}
