import { isOperator, type Policy } from "../types";

// ——— DR module ———
// Everyone reads DRs; operators issue new ones and update/cancel existing
// ones (spec 3.2 — cancel is modeled as "update" + status change).
export const deliveryReceiptPolicy: Policy = ({ role, can }) => {
  can("read", "DeliveryReceipt");

  if (isOperator(role)) {
    can(["issue", "update"], "DeliveryReceipt");
  }
};
