import type { Metadata } from "next";
import { requireActor } from "@/lib/authz";
import { defineAbilityFor } from "@/lib/ability";
import { PageHeader } from "@/components/page-header";
import { InquiriesView } from "@/modules/quotations/components/inquiries-view";

export const metadata: Metadata = { title: "Inquiries" };

export default async function InquiriesPage() {
  const ability = defineAbilityFor(await requireActor());

  return (
    <>
      <PageHeader
        title="Inquiries"
        description="Every customer ask, logged before it becomes a quote — Messenger, email, walk-in, or call."
      />
      <InquiriesView
        canWrite={ability.can("create", "Inquiry")}
        canQuote={ability.can("create", "Quotation")}
      />
    </>
  );
}
