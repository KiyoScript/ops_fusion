import type { Metadata } from "next";
import { requireActor } from "@/lib/authz";
import { PageHeader } from "@/components/page-header";
import { CustomerAccountView } from "@/modules/sales-audit/components/customer-account-view";

export const metadata: Metadata = { title: "Customer account" };

export default async function CustomerAccountPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  // Gated by the `receivables` module in (app)/layout.tsx — this route sits
  // under /sales-audit/receivables, which moduleForPath resolves by longest
  // prefix, so it inherits that switch.
  await requireActor();
  const { customerId } = await params;

  return (
    <>
      <PageHeader
        title="Customer account"
        description="Open invoices, credit held on account, and every payment made — with the invoices each one settled."
      />
      <CustomerAccountView customerId={customerId} />
    </>
  );
}
