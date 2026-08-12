import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { VatStatus } from "@/generated/prisma/enums";
import { VAT_STATUS_LABEL } from "../vat";

// Semantic colors (theme-aware) shared by the customer/company badges + the
// metrics cards, so the palette reads consistently across the module.
export const VAT_COLOR: Record<VatStatus, string> = {
  VAT: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300",
  NON_VAT: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300",
  NO_TIN: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-300",
};

const ACTIVE_COLOR =
  "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300";
export const COMPANY_COLOR =
  "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/15 dark:text-blue-300";

export function VatBadge({ status, className }: { status: VatStatus; className?: string }) {
  return (
    <Badge variant="outline" className={cn("font-normal", VAT_COLOR[status], className)}>
      {VAT_STATUS_LABEL[status]}
    </Badge>
  );
}

export function CustomerStatusBadge({ status }: { status: string }) {
  return status === "INACTIVE" ? (
    <Badge variant="outline" className="font-normal text-muted-foreground">Inactive</Badge>
  ) : (
    <Badge variant="outline" className={cn("font-normal", ACTIVE_COLOR)}>Active</Badge>
  );
}

export function CompanyBadge({ className }: { className?: string }) {
  return (
    <Badge variant="outline" className={cn("font-normal", COMPANY_COLOR, className)}>Company</Badge>
  );
}
