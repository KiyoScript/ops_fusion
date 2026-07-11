import type { Policy } from "../types";
import { jobOrderPolicy } from "./job-order";
import { maintenancePolicy } from "./maintenance";
import { deliveryReceiptPolicy } from "./delivery-receipt";

// Policy registry — the ONLY line to touch when a new module lands:
// add `policies/<module>.ts` and list it here. Rules are additive, so
// registration order never matters.
export const policies: Policy[] = [
  jobOrderPolicy,
  maintenancePolicy,
  deliveryReceiptPolicy,
  // TODO(QUOTATION): quotationPolicy
  // TODO(SALES-AUDIT): salesPolicy, auditPolicy
];
