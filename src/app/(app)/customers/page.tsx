import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const metadata: Metadata = { title: "Customers" };

export default function CustomersPage() {
  return (
    <ModulePlaceholder
      title="Customers"
      description="Shared customer master with classification-driven payment rules."
      phase="Phase 1"
    />
  );
}
