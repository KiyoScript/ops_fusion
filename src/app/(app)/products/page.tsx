import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const metadata: Metadata = { title: "Products" };

export default function ProductsPage() {
  return (
    <ModulePlaceholder
      title="Products & Services"
      description="Shared catalog used by quotation and job order line items."
      phase="Phase 1"
    />
  );
}
