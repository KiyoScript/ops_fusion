import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { BackButton } from "@/components/back-button";
import { JobOrderForm } from "@/modules/job-orders/components/job-order-form";

export const metadata: Metadata = { title: "New JO/PO" };

export default async function NewJobOrderPage() {
  const session = await auth();
  const role = session?.user?.role;
  if (role !== "ADMIN" && role !== "MANAGER" && role !== "ENCODER") {
    redirect("/job-orders");
  }

  return (
    <>
      <BackButton fallbackHref="/job-orders" label="Job Orders" />
      <PageHeader
        title="New JO/PO"
        description="Plain JOs get an auto-generated number (R-AD…). Tick PO or Non-JO to type the number manually."
      />
      <JobOrderForm mode="create" />
    </>
  );
}
