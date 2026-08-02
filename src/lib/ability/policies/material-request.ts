import { Role } from "@/generated/prisma/enums";
import { isOperator, type Policy } from "../types";

// ——— Material Requests (MACWebApp) ———
// Everyone reads MRs. Operators (MANAGER + ENCODER) submit requests, edit a
// rejected one, and cancel one that hasn't been released. MANAGER decides
// (approve / reject) and releases stock. ADMIN via manage-all.
//
// Approval and release are ALWAYS explicit steps — a request is created PENDING
// and never auto-approved on submit, not even for an admin. Having `approve`
// or `release` lets you act; it does not skip the gate.
export const materialRequestPolicy: Policy = ({ role, can }) => {
  can("read", "MaterialRequest");

  if (isOperator(role)) {
    can("create", "MaterialRequest"); // submit / edit-rejected / cancel
  }

  if (role === Role.MANAGER) {
    can("approve", "MaterialRequest"); // approve or reject a pending request
    can("release", "MaterialRequest"); // issue stock against an approved request
  }
};
