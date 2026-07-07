import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const metadata: Metadata = { title: "Delivery Receipts" };

export default function DeliveryReceiptsPage() {
  return (
    <ModulePlaceholder
      title="Delivery Receipts"
      description="DR issuance per completed JO line item, with advance payment application."
      phase="Phase 5"
    />
  );
}
