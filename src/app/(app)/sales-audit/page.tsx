import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const metadata: Metadata = { title: "Sales Audit" };

export default function SalesAuditPage() {
  return (
    <ModulePlaceholder
      title="Sales Audit"
      description="Sales records, collection receipts, reconciliation, and day locking."
      phase="Phase 4"
    />
  );
}
