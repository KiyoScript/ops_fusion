import { ColorBadge, type BadgeTone } from "@/components/color-badge";

const STATUS_BADGES: Record<string, { tone: BadgeTone; label: string }> = {
  DRAFT: { tone: "gray", label: "Draft" },
  PENDING_APPROVAL: { tone: "amber", label: "Pending approval" },
  APPROVED: { tone: "green", label: "Approved" },
  SENT: { tone: "blue", label: "Sent" },
  REJECTED: { tone: "red", label: "Rejected" },
  EXPIRED: { tone: "gray", label: "Expired" },
  CONVERTED: { tone: "purple", label: "Converted to JO" },
};

/** Lifecycle chip; a past-validity quote shows Expired without a status write. */
export function QuotationStatusBadge({
  status,
  isExpired,
}: {
  status: string;
  isExpired?: boolean;
}) {
  if (isExpired && (status === "APPROVED" || status === "SENT" || status === "DRAFT" || status === "PENDING_APPROVAL")) {
    return <ColorBadge tone="red" label="Expired" />;
  }
  const badge = STATUS_BADGES[status] ?? { tone: "auto" as const, label: status };
  return <ColorBadge tone={badge.tone} label={badge.label} />;
}
