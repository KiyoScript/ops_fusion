import { Role } from "@/generated/prisma/enums";
import { isOperator, type Policy } from "../types";

// ——— Sales & Audit module ———
// The legacy Sales-Audit roles map onto the fused ones:
//   cashier → ENCODER (issues receipts, registers booklets)
//   auditor → AUDITOR (verifies receipts; never issues them)
//   admin   → ADMIN   (approves booklets into service)
//
// Separation of duties is the point: the cashier who takes the money must not
// be the one who signs it off as verified.
export const salesAuditPolicy: Policy = ({ role, can }) => {
  can("read", "Sale");
  can("read", "Booklet");

  // Cashiers take payments and register booklets — but cannot approve them.
  if (isOperator(role)) {
    can("create", "Sale");
    can("create", "Booklet");
  }

  // Auditors verify receipts. They read everything and sign it off.
  if (role === Role.AUDITOR) {
    can("audit", "Sale");
  }

  // Admin activates a booklet into service (legacy: only admin approves).
  if (role === Role.ADMIN) {
    can("approve", "Booklet");
    can("audit", "Sale");
  }
};
