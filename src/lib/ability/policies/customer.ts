import { isOperator, type Policy } from "../types";

// ——— Customer master (shared) ———
// Everyone reads the customer directory. Operators (MANAGER + ENCODER) — the
// same staff who create customers through the quotation flow — may edit the
// master record (contact, TIN, status, …). ADMIN via manage-all.
export const customerPolicy: Policy = ({ role, can }) => {
  can("read", "Customer");
  if (isOperator(role)) {
    can("update", "Customer");
  }
};
