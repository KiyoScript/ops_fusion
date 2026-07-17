import type { Policy } from "../types";
import { jobOrderPolicy } from "./job-order";
import { maintenancePolicy } from "./maintenance";
import { deliveryReceiptPolicy } from "./delivery-receipt";
import { quotationPolicy } from "./quotation";
import { salesAuditPolicy } from "./sales-audit";

// Policy registry — the ONLY line to touch when a new module lands:
// add `policies/<module>.ts` and list it here. Rules are additive, so
// registration order never matters.
export const policies: Policy[] = [
  jobOrderPolicy,
  maintenancePolicy,
  deliveryReceiptPolicy,
  quotationPolicy,
  salesAuditPolicy,
];
