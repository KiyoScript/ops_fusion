import { AbilityBuilder, createMongoAbility } from "@casl/ability";
import { Role } from "@/generated/prisma/enums";
import { ForbiddenError } from "@/lib/errors";
import type { Actor } from "@/lib/authz";
import { policies } from "./policies";
import type { AppAbility, AppAction, AppSubject } from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// Central permission layer (CASL), organized Pundit-style: one policy file
// per resource in ./policies, composed here. Each legacy system (JOWebApp,
// quotation_system, Sales-Audit) had its own roles/permissions — they all
// become policies in ONE ability.
//
// Adding a module = one new file in ./policies + one registry line. Do NOT
// scatter role checks in services; declare rules in the module's policy.
//
// Works on both server and client (pure function of the role): services call
// assertCan(), pages/components call defineAbilityFor(actor).can().
// ═══════════════════════════════════════════════════════════════════════════

export type { AppAbility, AppAction, AppSubject } from "./types";

export function defineAbilityFor(actor: Pick<Actor, "role">): AppAbility {
  const { can, cannot, build } = new AbilityBuilder<AppAbility>(
    createMongoAbility
  );

  // ADMIN bypasses every policy (Pundit's admin short-circuit).
  if (actor.role === Role.ADMIN) {
    can("manage", "all");
  }

  for (const policy of policies) {
    policy({ role: actor.role, can, cannot });
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

/**
 * Non-throwing sibling of assertCan, for the case where an actor may perform
 * an action but only PART of the payload is theirs to set.
 *
 * A company edit is the motivating example: an encoder may fix the phone
 * number, but the credit limit on the same form is admin-only reference data
 * (docs/sales-contract.md R8). Refusing the whole edit would be wrong, and so
 * would silently accepting the credit change — so the service asks, and keeps
 * the fields the actor is not entitled to move.
 */
export function can(
  actor: Actor,
  action: AppAction,
  subject: AppSubject
): boolean {
  return defineAbilityFor(actor).can(action, subject);
}
