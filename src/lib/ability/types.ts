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
  | "approve" // JO: record the customer's approval; Quotation: supervisor sign-off; Booklet: activate into service
  | "send" // mark a quotation as sent to the customer
  | "convert" // turn an approved quotation into a Job Order
  | "issue" // issue a delivery receipt
  | "audit" // auditor's sign-off on a receipt (legacy verified_by)
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
  // ——— Quotation module (quotation_system) ———
  | "Quotation"
  | "Inquiry" // spec 1.2 step 1 — the pre-quote inquiry log
  // ——— TODO(QUOTATION-PHASE-NEXT): "PriceList" (maintenance UI for PriceRule)
  // ——— Sales & Audit module (Sales-Audit) ———
  | "Sale" // receipts: JO receipt, Sales Invoice, Collection Receipt
  | "Booklet" // the BIR booklets those receipts draw their numbers from
  // ——— TODO(SALES-AUDIT-PHASE-NEXT): "Reconciliation" (day locking, deposits)
  // ——— System administration ———
  | "ModuleFlag" // enable/disable feature modules — admin only (manage-all)
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
