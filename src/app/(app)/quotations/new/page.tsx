import { redirect } from "next/navigation";
import { requireActor } from "@/lib/authz";
import { defineAbilityFor } from "@/lib/ability";

// Quotations use the single-page form (not a step-by-step wizard) — this entry
// just forwards to it, carrying an inquiryId when drafting from an inquiry.
export default async function NewQuotationPage({
  searchParams,
}: {
  searchParams: Promise<{ inquiryId?: string }>;
}) {
  if (defineAbilityFor(await requireActor()).cannot("create", "Quotation")) {
    redirect("/quotations");
  }
  const { inquiryId } = await searchParams;
  redirect(
    inquiryId
      ? `/quotations/new/custom?inquiryId=${encodeURIComponent(inquiryId)}`
      : "/quotations/new/custom"
  );
}
