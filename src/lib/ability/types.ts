import type { AbilityBuilder, MongoAbility } from "@casl/ability";
import { Role } from "@/generated/prisma/enums";

// Actions/subjects for the whole fused system. A module's policy may only
// grant combinations declared here — the compiler rejects anything else.

export type AppAction =
  | "manage" // CASL wildcard: everything
  | "create"
  | "read"
  | "update"
  | "archive"
  | "import"
  | "move-deadline"
  | "approve" // record the customer's approval (attachment required)
  | "issue" // issue a delivery receipt
  | "maintain";

export type AppSubject =
  | "all" // CASL wildcard: every subject
  // ——— JO module (JOWebApp) ———
  | "JobOrder"
  | "JobOrderItem"
  | "Archive" // the admin-only Archive JOs page
  | "Maintenance" // statuses / categories / employees reference lists
  // ——— DR module ———
  | "DeliveryReceipt"
  // ——— TODO(QUOTATION): "Quotation", "PriceList", …
  // ——— TODO(SALES-AUDIT): "Sale", "Booklet", "Reconciliation", …
  | never;

export type AppAbility = MongoAbility<[AppAction, AppSubject]>;

/** What one resource policy receives — nothing more (interface segregation). */
export type PolicyContext = {
  role: Role;
  can: AbilityBuilder<AppAbility>["can"];
  cannot: AbilityBuilder<AppAbility>["cannot"];
};

/** One resource's rules, Pundit-style: JobOrderPolicy, DeliveryReceiptPolicy… */
export type Policy = (ctx: PolicyContext) => void;

/** MANAGER + ENCODER — staff with the legacy "submit" rights (encode/edit
 *  operational records). ADMIN never needs listing: it gets manage-all in
 *  the composition root. */
export const isOperator = (role: Role): boolean =>
  role === Role.MANAGER || role === Role.ENCODER;
