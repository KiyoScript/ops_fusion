import { Role } from "@/generated/prisma/enums";
import { isOperator, type Policy } from "../types";

// ——— Withholding certificate register (BIR 2307 / 2306) ———
//
// The certificate is a tax record, not a counter document: it is what we file
// to claim back money a customer already remitted for us. So the rights are
// shaped around filing rather than selling.
//
// A cashier records the form when it arrives — that is data entry, and making
// it wait on a manager is how certificates end up in a drawer instead of the
// register. Voiding one is not: it releases a claimed credit back onto the
// chase list and rewrites what we tell BIR we hold, which takes a supervisor,
// the same standard as voiding a receipt.
export const withholdingPolicy: Policy = ({ role, can }) => {
  can("read", "WithholdingCertificate");

  if (isOperator(role)) {
    can("create", "WithholdingCertificate");
    can("update", "WithholdingCertificate");
  }

  if (role === Role.MANAGER) {
    can("void", "WithholdingCertificate");
  }

  if (role === Role.ADMIN) {
    can("create", "WithholdingCertificate");
    can("update", "WithholdingCertificate");
    can("void", "WithholdingCertificate");
  }
};
