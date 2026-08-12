import type { VatStatus } from "@/generated/prisma/enums";

/** Human labels for the tax-standing enum (VAT / NON_VAT / NO_TIN). */
export const VAT_STATUS_LABEL: Record<VatStatus, string> = {
  VAT: "VAT",
  NON_VAT: "Non-VAT",
  NO_TIN: "No TIN",
};
