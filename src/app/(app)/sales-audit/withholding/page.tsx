import type { Metadata } from "next";
import { requireActor } from "@/lib/authz";
import { defineAbilityFor } from "@/lib/ability";
import { PageHeader } from "@/components/page-header";
import { WithholdingRegisterView } from "@/modules/sales-audit/components/withholding-register-view";

export const metadata: Metadata = { title: "Withholding Certificates" };

export default async function WithholdingCertificatesPage() {
  const ability = defineAbilityFor(await requireActor());

  return (
    <>
      <PageHeader
        title="Withholding Certificates"
        description="BIR Forms 2307 and 2306 — the paper behind every peso a customer kept back and remitted for us. Recording the deduction closes the invoice; the certificate is what turns it back into money."
      />
      <WithholdingRegisterView
        canRecord={ability.can("create", "WithholdingCertificate")}
        canVoid={ability.can("void", "WithholdingCertificate")}
      />
    </>
  );
}
