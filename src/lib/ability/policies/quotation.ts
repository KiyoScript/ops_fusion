import { Role } from "@/generated/prisma/enums";
import { isOperator, type Policy } from "../types";

// ——— Quotation module (quotation_system) ———
// Everyone reads quotes and the inquiry log; operators draft/send/convert
// and log inquiries. Supervisor sign-off (approve) and archive stay with
// MANAGER — the legacy dashboard denied Approve/Reject to sales/staff, and
// that approval gate is the point of the workflow.
export const quotationPolicy: Policy = ({ role, can }) => {
  can("read", ["Quotation", "Inquiry"]);

  if (isOperator(role)) {
    can(["create", "update", "send", "convert"], "Quotation");
    can(["create", "update"], "Inquiry");
  }
  if (role === Role.MANAGER) {
    can(["approve", "archive"], "Quotation");
  }
};
