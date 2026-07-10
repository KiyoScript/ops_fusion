import {
  AbilityBuilder,
  createMongoAbility,
  type MongoAbility,
} from "@casl/ability";
import { Role } from "@/generated/prisma/enums";
import { ForbiddenError } from "@/lib/errors";
import type { Actor } from "@/lib/authz";

// ═══════════════════════════════════════════════════════════════════════════
// Central permission layer for the fused system (CASL). Each legacy system
// (JOWebApp, quotation_system, Sales-Audit) had its own roles/permissions —
// here they all become rules in ONE ability, grouped by module.
//
// Integrated so far: JO module (JOWebApp), Quotation module
// (quotation_system), and the DR module. When the other modules land, add
// their actions/subjects and a rules section below — do NOT scatter role
// checks in services again.
//
// Works on both server and client (pure function of the role): services call
// assertCan(), pages/components call defineAbilityFor(actor).can().
// ═══════════════════════════════════════════════════════════════════════════

export type AppAction =
  | "manage" // CASL wildcard: everything
  | "create"
  | "read"
  | "update"
  | "archive"
  | "import"
  | "move-deadline"
  | "approve" // JO: record the customer's approval; Quotation: supervisor sign-off
  | "send" // mark a quotation as sent to the customer
  | "convert" // turn an approved quotation into a Job Order
  | "issue" // issue a delivery receipt
  | "maintain";

export type AppSubject =
  | "all" // CASL wildcard: every subject
  // ——— JO module (JOWebApp) ———
  | "JobOrder"
  | "JobOrderItem"
  | "Archive" // the admin-only Archive JOs page
  | "Maintenance" // statuses / categories / employees reference lists
  // ——— Quotation module (quotation_system) ———
  | "Quotation"
  // ——— TODO(QUOTATION-PHASE-4): "PriceList"
  // ——— DR module ———
  | "DeliveryReceipt"
  // ——— TODO(SALES-AUDIT): "Sale", "Booklet", "Reconciliation", …
  | never;

export type AppAbility = MongoAbility<[AppAction, AppSubject]>;

export function defineAbilityFor(actor: Pick<Actor, "role">): AppAbility {
  const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);

  // Every authenticated user can read the JO board/calendar + pickers,
  // quotations, and DRs.
  can("read", [
    "JobOrder",
    "JobOrderItem",
    "Maintenance",
    "Quotation",
    "DeliveryReceipt",
  ]);

  switch (actor.role) {
    case Role.ADMIN:
      can("manage", "all");
      break;
    case Role.MANAGER: // ≈ legacy Branch Supervisor / Production Planner
      can(["create", "update", "approve"], ["JobOrder"]);
      can(["create", "update"], ["JobOrderItem"]);
      can("archive", "JobOrder");
      can("import", "JobOrder");
      can("move-deadline", "JobOrder"); // legacy: Admin + Production Planner
      can("maintain", "Maintenance");
      // Quotation: supervisor sign-off lives here (legacy dashboard denied
      // Approve/Reject to sales/staff roles).
      can(["create", "update", "send", "approve", "convert", "archive"], "Quotation");
      can(["issue", "update"], "DeliveryReceipt");
      break;
    case Role.ENCODER: // ≈ legacy Sales/Cashier submit rights
      can(["create", "update", "approve"], ["JobOrder"]);
      can(["create", "update"], ["JobOrderItem"]);
      // Quotation: encoders draft/send/convert but cannot approve (the
      // approve gate is the point of the workflow) nor archive.
      can(["create", "update", "send", "convert"], "Quotation");
      can(["issue", "update"], "DeliveryReceipt");
      break;
    case Role.AUDITOR:
    case Role.VIEWER:
      // read-only (Archive stays admin-only, like the legacy archive page)
      break;
  }

  return build();
}

/** Service-layer guard: throws ForbiddenError when the action is not allowed. */
export function assertCan(
  actor: Actor,
  action: AppAction,
  subject: AppSubject
): void {
  if (!defineAbilityFor(actor).can(action, subject)) {
    throw new ForbiddenError();
  }
}
