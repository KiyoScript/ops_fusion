import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const metadata: Metadata = { title: "Quotations" };

export default function QuotationsPage() {
  return (
    <ModulePlaceholder
      title="Quotations"
      description="Quote creation, supervisor approval, and conversion to Job Orders."
      phase="Phase 3"
    />
  );
}
