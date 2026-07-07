import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const metadata: Metadata = { title: "Job Orders" };

export default function JobOrdersPage() {
  return (
    <ModulePlaceholder
      title="Job Orders"
      description="JO lifecycle: draft → review → approval → production → completion."
      phase="Phase 2"
    />
  );
}
