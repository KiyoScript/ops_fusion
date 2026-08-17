#!/usr/bin/env node
/**
 * Sales & Finance Contract guard.
 *
 * Injects the relevant rules from docs/sales-contract.md when a prompt or an
 * edit touches a money-bearing surface. Advisory only — it never blocks a tool
 * call and never fails a session. If anything goes wrong it exits silently,
 * because a broken guard must not stop the other track from working.
 *
 * Wired in .claude/settings.json for two events:
 *   UserPromptSubmit — the dev asked for something sales-adjacent
 *   PostToolUse      — the dev edited a sales-adjacent file, said so or not
 */

import { readFileSync } from "node:fs";

const CONTRACT = "docs/sales-contract.md";

// ── money-bearing paths ────────────────────────────────────────────────────
// Seams first: files core dev owns where this contract still applies.
const PATH_RULES = [
  {
    re: /src[\/\\]modules[\/\\]customers[\/\\]/i,
    what: "the Customer master — where credit policy lives",
    rules: [
      "R2  every Sale / CollectionReceipt read filters `deletedAt: null` AND `voidedAt: null` — inside `_count` too, or voided receipts count as revenue",
      "R7  no client-side sum or date-filter over a `take: N` slice; financial totals are computed in SQL over the whole set",
      "R8  `creditTermDays` / `creditLimit` require `assertCan(actor, \"maintain\", \"Maintenance\")` — an `update Customer` path must omit them from the payload",
      "R9  service methods returning credit limits, TINs, sales history or profile attachments must call `assertCan` — `_actor` is a bug",
      "R10 editing a Customer must never rewrite an issued document's billedTo* / dueDate / VAT snapshot",
      "R12 `vatStatus` / `tin` changes log their own ActivityLog action, never a generic `update`",
      "R15 a Company credit ceiling is company-wide — aggregating per contact multiplies it by the contact count",
    ],
  },
  {
    re: /src[\/\\]modules[\/\\]job-orders[\/\\]/i,
    what: "Job Orders — the JO total becomes an invoice amount",
    rules: [
      "The downpayment is a `JO_SLIP` Sale (books revenue), not a CollectionReceipt",
      "`Sale.jobOrderId` is deliberately NOT unique — one JO takes a JO_SLIP then a later SI",
      "R11 cancelling a JO must not delete or orphan an already-issued receipt; void in place, keep the serial",
      "Changing how the JO total is computed changes what gets billed — flag it to the finance track",
    ],
  },
  {
    re: /src[\/\\]modules[\/\\]delivery-receipts[\/\\]/i,
    what: "Delivery Receipts — goods released against credit",
    rules: [
      "A DR is not a revenue event; issuing one never creates a Sale",
      "DR issuance is gated on advance-payment / credit state — changing that gate changes when the shop releases goods on credit",
      "DR lines link to `JobOrderItem`; billing reads through that link",
    ],
  },
  {
    re: /src[\/\\]modules[\/\\]inventory[\/\\]/i,
    what: "Inventory — upstream of the Purchasing → AP seam",
    rules: [
      "A Supplier is NOT a Customer — never reuse the Customer model, policies, or attachments for suppliers",
      "The chain is PR → PO → Receiving → supplier invoice → payable; the supplier invoice is the finance seam",
      "Costing feeds JO margin, which feeds pricing",
    ],
  },
  {
    re: /prisma[\/\\]schema[\/\\](sale|collection-receipt|advance-payment|booklet|audit)\.prisma/i,
    what: "a finance-owned schema file",
    rules: [
      "This file belongs to the finance track — core dev must not edit it (AGENTS.md branch discipline)",
      "If a change here is genuinely needed, raise it rather than editing",
    ],
  },
  {
    re: /prisma[\/\\]schema[\/\\](customer|company|job-order|delivery-receipt)\.prisma/i,
    what: "a shared schema file with finance-owned fields",
    rules: [
      "R1  money is `Decimal @db.Decimal(12, 2)`, qty is `Int` — never Float",
      "R8  `creditTermDays` / `creditLimit` are finance-owned; changing their shape or meaning is a cross-track change",
      "R10 issued-document snapshot columns (billedTo*, dueDate, vatableSales, vatAmount) are immutable — no backfills",
      "R14 soft deletes only (`deletedAt`)",
    ],
  },
  {
    re: /src[\/\\]modules[\/\\](sales-audit|quotations)[\/\\]/i,
    what: "a finance-track module",
    rules: [
      "This module belongs to the finance track — core dev must not touch it (AGENTS.md branch discipline)",
    ],
  },
];

// ── prompt keywords ────────────────────────────────────────────────────────
// Deliberately specific. Vague words ("balance", "account") fire on too much
// unrelated work, and a guard that cries wolf gets switched off.
const PROMPT_RE =
  /\b(invoice|receipt|collection\s*receipt|charge\s*invoice|sales?\s*invoice|receivable|a\/r|aging|statement\s*of\s*account|credit\s*(limit|terms?|hold|control)|advance\s*payment|downpayment|down\s*payment|booklet|vat|non-?vat|tin|bir|payable|supplier\s*invoice|settle(d|ment)?|allocation|void(ed|ing)?\s*(a\s*)?receipt|outstanding\s*balance|overdue|customer\s*credit)\b/i;

const HEADER =
  `⚖️  Sales & Finance Contract — this touches money.\n` +
  `Read ${CONTRACT} before writing code, and work the Sales Impact Checklist ` +
  `at the end of it before calling the change done.\n`;

const FOOTER =
  `\nThese seams belong to the finance track even when the file belongs to core dev. ` +
  `Their failures surface as wrong VAT reports and uncollectable receivables — ` +
  `not as errors in your own module.\n` +
  `Verify with: npx tsx scripts/verify-sales-contract.ts`;

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function emit(event, context) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: event,
        additionalContext: context,
      },
    })
  );
}

function main() {
  const raw = readStdin();
  if (!raw.trim()) return;

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return;
  }

  const event = payload.hook_event_name ?? payload.hookEventName;

  if (event === "UserPromptSubmit") {
    const prompt = String(payload.prompt ?? "");
    if (!PROMPT_RE.test(prompt)) return;
    emit(
      "UserPromptSubmit",
      `${HEADER}\nThis request mentions money-bearing work. The hard rules are ` +
        `R1–R15 in ${CONTRACT}; the ones broken most often are R2 (filter ` +
        `\`deletedAt\` and \`voidedAt\`), R3 (open balance is ` +
        `\`amount − amountPaid − settledAmount\`, never \`paymentStatus\`), ` +
        `R7 (no client-side totals over a paginated slice), and R8 (credit ` +
        `fields are admin-gated).${FOOTER}`
    );
    return;
  }

  if (event === "PostToolUse") {
    const input = payload.tool_input ?? {};
    const file = String(input.file_path ?? input.filePath ?? "");
    if (!file) return;

    const match = PATH_RULES.find((r) => r.re.test(file));
    if (!match) return;

    emit(
      "PostToolUse",
      `${HEADER}\nYou just edited ${match.what}. Rules that apply here:\n` +
        match.rules.map((r) => `  • ${r}`).join("\n") +
        FOOTER
    );
  }
}

try {
  main();
} catch {
  // Never let the guard break a session.
}
process.exit(0);
