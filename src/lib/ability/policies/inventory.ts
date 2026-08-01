import { Role } from "@/generated/prisma/enums";
import { isOperator, type Policy } from "../types";

// ——— Inventory & Materials (MACWebApp) ———
// Everyone reads stock — levels, ledger, adjustments, counts (dropdown pickers
// and reports). Operators (MANAGER + ENCODER) run day-to-day stock ops: they
// REQUEST adjustments and run cycle counts. MANAGER curates the item/supplier
// master AND signs off on stock movements. ADMIN via manage-all.
//
// Approval is ALWAYS a separate explicit step — a stock adjustment is created
// PENDING and never auto-approved on creation, not even for an admin. Having
// the `approve` ability lets you decide; it does not skip the gate.
export const inventoryPolicy: Policy = ({ role, can }) => {
  can("read", "Material");
  can("read", "Supplier");
  can("read", "StockLedger");
  can("read", "StockAdjustment");
  can("read", "CycleCount");

  if (isOperator(role)) {
    can("create", "StockAdjustment");
    can("create", "CycleCount");
    can("update", "CycleCount"); // edit a draft count before completing it
  }

  if (role === Role.MANAGER) {
    can("maintain", "Material"); // create / edit / archive item master
    can("maintain", "Supplier");
    can("approve", "StockAdjustment"); // approve or reject a pending adjustment
    can("approve", "CycleCount"); // post a completed count's variances
  }
};
