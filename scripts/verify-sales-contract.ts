// Static verification of docs/sales-contract.md — the rules that guard the
// seam between the operations track and the finance track.
// Run: npx tsx scripts/verify-sales-contract.ts
//
// This is a SOURCE scanner, not an end-to-end script: it enforces coding rules
// across the whole codebase, so it needs no database and is safe in CI.
//
// Every rule here maps to a numbered rule in docs/sales-contract.md and exists
// because breaking it produces a specific financial defect. Precision matters
// more than coverage — a scanner that cries wolf gets switched off — so each
// rule is deliberately narrow, and anything legitimately outside it opts out
// with an escape-hatch comment on the line above:
//
//   // contract:allow R2 — the void ledger must see voided rows by definition
//
// A bare `// contract:allow` with no reason does NOT satisfy the scanner.
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const SRC = join(ROOT, "src");
const SCHEMA = join(ROOT, "prisma", "schema");
const BASELINE = join(ROOT, "scripts", "sales-contract-baseline.json");

// ── the ratchet ────────────────────────────────────────────────────────────
//
// This contract was written against a codebase that predates it, so it starts
// with real debt in modules the finance track does not own. A script that is
// red on day one and stays red is a script everyone learns to ignore, and then
// it catches nothing.
//
// So: known violations are recorded in the baseline and reported as debt
// WITHOUT failing the run. Anything not in the baseline fails immediately.
// The result is a one-way ratchet — the existing backlog can be paid down on
// its own schedule, but no new violation can be introduced quietly.
//
// Regenerate after paying debt down:  npx tsx scripts/verify-sales-contract.ts --update-baseline
// (Never regenerate to silence a NEW hit — that is what the escape-hatch
// comment is for, and it makes you write down the reason.)

const UPDATING = process.argv.includes("--update-baseline");

type Violation = { key: string; rule: string; file: string; line: number; msg: string };

const found: Violation[] = [];
let passes = 0;

const rel = (p: string) => relative(ROOT, p).split(sep).join("/");

/** Stable across edits: line numbers shift, the offence does not. */
const keyOf = (rule: string, file: string, msg: string) =>
  `${rule}|${rel(file)}|${msg.replace(/\d+/g, "#").slice(0, 120)}`;

// Counts, not just keys. Line numbers shift as files are edited, so a key
// deliberately ignores them — which means N identical offences in one file
// share one key. Recording how MANY were known is what stops a tenth `_actor`
// sliding in behind nine grandfathered ones.
let baseline = new Map<string, number>();
try {
  const raw = JSON.parse(readFileSync(BASELINE, "utf8")).violations;
  baseline = new Map(
    Array.isArray(raw)
      ? (raw as string[]).map((k) => [k, Number.POSITIVE_INFINITY] as const)
      : Object.entries(raw as Record<string, number>)
  );
} catch {
  // No baseline yet — every violation is new, which is the correct default.
}

function fail(rule: string, file: string, line: number, msg: string) {
  found.push({ key: keyOf(rule, file, msg), rule, file, line, msg });
}
function pass(name: string) {
  passes++;
  console.log(`  ✓ ${name}`);
}

// ── file walking ───────────────────────────────────────────────────────────

function walk(dir: string, ext: RegExp): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === "generated")
      continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, ext));
    else if (ext.test(entry)) out.push(full);
  }
  return out;
}

const lineAt = (src: string, index: number) =>
  src.slice(0, index).split("\n").length;

/**
 * True when a reasoned opt-out for this rule sits just above `index`.
 *
 * Scans a few lines up rather than exactly one: the natural place to write the
 * comment is above the method or the awaited call, not wedged between a
 * `return` and its argument. A bare `contract:allow` with no reason does not
 * count — the point of the hatch is that someone had to justify it.
 */
const OPT_OUT_WINDOW = 6;

function optedOut(src: string, index: number, rule: string): boolean {
  const before = src.slice(0, index).split("\n");
  const window = before.slice(Math.max(0, before.length - 1 - OPT_OUT_WINDOW), -1);
  return window.some((line) => {
    const m = line.match(/contract:allow\s+(\w+)\s*(?:—|--|-)\s*(.+)/);
    return !!m && m[1] === rule && m[2].trim().length > 3;
  });
}

/** From the `{` at or after `from`, the balanced block including both braces. */
function blockAt(src: string, from: number): string {
  const open = src.indexOf("{", from);
  if (open === -1) return "";
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return src.slice(open);
}

/**
 * A query block plus any where-clause it builds in a local variable.
 *
 * `where: saleWhere` is idiomatic here — the filter is assembled above the
 * call, often conditionally. Reading only the call site would report those as
 * unfiltered, and a scanner that flags correct code is one people stop
 * believing, so resolve the identifier and append its initialiser.
 */
function blockWithWhereVars(src: string, block: string): string {
  let resolved = block;
  // Covers both idioms: a mutable filter built above the call
  // (`where: saleWhere`) and a shared constant reused across selects
  // (`where: LIVE_RECEIPT`). The second is the better pattern — one definition
  // of "live receipt" for every query on the page — and a scanner that
  // punished it would push people back to copy-pasting the filter.
  const re = /\b(?:where|filter)\s*:\s*(?:\.\.\.)?([A-Za-z_$][\w$]*)\b/g;
  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = re.exec(block))) {
    const name = m[1];
    if (name === "null" || name === "undefined" || seen.has(name)) continue;
    seen.add(name);
    const decl = new RegExp(`\\b(?:const|let|var)\\s+${name}\\b[^=]*=`).exec(src);
    if (decl) resolved += blockAt(src, decl.index + decl[0].length);
    // Also pick up later mutations: `saleWhere.deletedAt = null`.
    const mut = new RegExp(`\\b${name}\\.(\\w+)\\s*=`, "g");
    let mm: RegExpExecArray | null;
    while ((mm = mut.exec(src))) resolved += ` ${mm[1]}: `;
  }
  // A spread of a shared filter — `where: { ...LIVE_RECEIPT, customerId }`.
  const spread = /\.\.\.([A-Z][A-Z0-9_]*)\b/g;
  while ((m = spread.exec(block))) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    const decl = new RegExp(`\\bconst\\s+${m[1]}\\b[^=]*=`).exec(src);
    if (decl) resolved += blockAt(src, decl.index + decl[0].length);
  }
  return resolved;
}

// ══════════════════════════════════════════════════════════════════════════
// R1 — money is Decimal(12,2), qty is Int. Never Float.
// ══════════════════════════════════════════════════════════════════════════

const MONEY_FIELD =
  /^\s*(\w*(?:amount|total|price|cost|limit|paid|balance|subtotal|discount|vat|tendered|change|settled|rate)\w*)\s+(Decimal|Float|Int)(\??)/i;

// A figure that lands on a DOCUMENT (invoice, receipt, statement) is settled to
// the centavo and must carry scale 2. A per-unit cost or rate is an input to
// those figures, not one of them, and legitimately carries more scale — a sheet
// of paper costs ₱0.3125, and rounding that to ₱0.31 before multiplying by
// 5,000 loses ₱62.50. So scale 2 is required for the former, a floor for the
// latter.
const UNIT_SCALE_OK = /(unit|per)(cost|price|rate)|cost(perpc|peruom)/i;

function checkR1() {
  let bad = 0;
  for (const file of walk(SCHEMA, /\.prisma$/)) {
    const src = readFileSync(file, "utf8");
    src.split("\n").forEach((line, i) => {
      const m = line.match(MONEY_FIELD);
      if (!m) return;
      const [, name, type] = m;

      if (type === "Float") {
        bad++;
        fail("R1", file, i + 1, `Money field \`${name}\` is Float — binary floating point cannot represent centavos exactly. Use Decimal.`);
        return;
      }
      if (type !== "Decimal") return;

      const scaled = line.match(/@db\.Decimal\((\d+),\s*(\d+)\)/);
      if (!scaled) {
        bad++;
        fail("R1", file, i + 1, `Decimal field \`${name}\` has no explicit @db.Decimal(precision, scale) — Prisma's default (65,30) is not a money type.`);
        return;
      }
      const scale = Number(scaled[2]);
      const isUnitRate = UNIT_SCALE_OK.test(name.replace(/_/g, ""));
      if (isUnitRate) {
        if (scale < 2) {
          bad++;
          fail("R1", file, i + 1, `Unit rate \`${name}\` has scale ${scale}; needs at least 2.`);
        }
      } else if (scale !== 2) {
        bad++;
        fail("R1", file, i + 1, `Document amount \`${name}\` has scale ${scale}, not 2. Amounts printed on a receipt are settled to the centavo.`);
      }
    });
  }
  if (!bad)
    pass("R1  money is Decimal with explicit scale — amounts at 2dp, unit rates at 2dp or finer, never Float");
}

// ══════════════════════════════════════════════════════════════════════════
// R2 — never read a financial row without excluding voided and deleted.
// ══════════════════════════════════════════════════════════════════════════

// Models carrying both flags, and the relation names that point at them.
const VOIDABLE = ["sale", "collectionReceipt"];
const SOFT_ONLY = ["advancePayment"];
const FIN_RELATIONS: Record<string, "voidable" | "soft"> = {
  sales: "voidable",
  collectionReceipts: "voidable",
  crAllocations: "voidable",
  advancePayments: "soft",
};

const READ_OPS = "findMany|findFirst|findUnique|count|aggregate|groupBy";

function checkR2() {
  let bad = 0;
  const files = walk(SRC, /\.(ts|tsx)$/);

  for (const file of files) {
    const src = readFileSync(file, "utf8");

    // ── 2a: direct client reads — prisma.sale.findMany({ ... }) ──
    for (const model of [...VOIDABLE, ...SOFT_ONLY]) {
      const re = new RegExp(`prisma\\.${model}\\.(${READ_OPS})\\s*\\(`, "g");
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        const block = blockWithWhereVars(
          src,
          blockAt(src, m.index + m[0].length - 1)
        );
        const needsVoid = VOIDABLE.includes(model);
        const missing: string[] = [];
        if (!/deletedAt\s*:/.test(block)) missing.push("deletedAt: null");
        if (needsVoid && !/voidedAt\s*:/.test(block)) missing.push("voidedAt: null");
        if (missing.length && !optedOut(src, m.index, "R2")) {
          bad++;
          fail(
            "R2",
            file,
            lineAt(src, m.index),
            `prisma.${model}.${m[1]} does not filter ${missing.join(" / ")}. ` +
              `Voided and deleted receipts must never read as live.`
          );
        }
      }
    }

    // ── 2b: relation selects — sales: { select: ... } with no where ──
    for (const [relation, kind] of Object.entries(FIN_RELATIONS)) {
      const re = new RegExp(`\\b${relation}\\s*:\\s*\\{`, "g");
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        const raw = blockAt(src, m.index + m[0].length - 1);
        // Only Prisma selects — a plain object literal has no select/orderBy.
        if (!/\b(select|orderBy|take|include)\s*:/.test(raw)) continue;
        const block = blockWithWhereVars(src, raw);
        const missing: string[] = [];
        if (!/deletedAt\s*:/.test(block)) missing.push("deletedAt: null");
        if (kind === "voidable" && !/voidedAt\s*:/.test(block))
          missing.push("voidedAt: null");
        if (missing.length && !optedOut(src, m.index, "R2")) {
          bad++;
          fail(
            "R2",
            file,
            lineAt(src, m.index),
            `relation \`${relation}\` is selected without where: { ${missing.join(", ")} }.`
          );
        }
      }
    }

    // ── 2c: bare relation counts — _count: { select: { sales: true } } ──
    const countRe = /_count\s*:\s*\{/g;
    let cm: RegExpExecArray | null;
    while ((cm = countRe.exec(src))) {
      const block = blockWithWhereVars(
        src,
        blockAt(src, cm.index + cm[0].length - 1)
      );
      for (const relation of Object.keys(FIN_RELATIONS)) {
        const bare = new RegExp(`\\b${relation}\\s*:\\s*true`);
        if (bare.test(block) && !optedOut(src, cm.index, "R2")) {
          bad++;
          fail(
            "R2",
            file,
            lineAt(src, cm.index),
            `_count selects \`${relation}: true\` — a bare count includes voided ` +
              `and deleted rows. Use \`${relation}: { where: { deletedAt: null, ... } }\`.`
          );
        }
      }
    }
  }
  if (!bad)
    pass("R2  every financial read filters deletedAt / voidedAt — relations and _count included");
}

// ══════════════════════════════════════════════════════════════════════════
// R8 — creditTermDays / creditLimit are admin-gated everywhere.
// ══════════════════════════════════════════════════════════════════════════

// Repositories are dumb by design (AGENTS.md: repositories hold ALL Prisma
// calls, services hold assertCan), so the gate is checked on the SERVICE that
// calls them. A service writing credit fields must assert the Maintenance
// ability somewhere in the file.
function checkR8() {
  let bad = 0;
  const services = walk(SRC, /\.ts$/).filter((f) =>
    /[\\/]services[\\/]/.test(f)
  );

  for (const file of services) {
    const src = readFileSync(file, "utf8");

    // A WRITE, not a read. `creditTermDays: c.creditTermDays` in a DTO mapper
    // is reading the field back out and is fine; `creditTermDays:
    // input.creditTermDays` is user-supplied credit policy going in, and that
    // is the thing the Maintenance gate exists to control. Matching on the
    // source of the value separates the two cleanly, where matching on the
    // field name alone flags every mapper in the module.
    const writes =
      /\bcredit(?:TermDays|Limit)\s*:[^,;\n]*\b(?:input|body|payload|dto|co|billing)\b/.exec(
        src
      );
    if (!writes) continue;
    if (!/\b(update|create|set|sync)\w*\s*\(/.test(src)) continue;
    // Two acceptable gates. `assertCan` refuses the whole call — right when the
    // method exists only to set credit. `can(...)` is the field-level form:
    // the edit succeeds, but the credit fields are held at their current value
    // for an actor who may not move them. A company edit needs the second,
    // because refusing an encoder's phone-number correction would be absurd.
    if (
      /(?:assert)?[Cc]an\(\s*\w+\s*,\s*"maintain"\s*,\s*"Maintenance"\s*\)/.test(src)
    )
      continue;
    if (optedOut(src, writes.index, "R8")) continue;
    bad++;
    fail(
      "R8",
      file,
      lineAt(src, writes.index),
      `writes creditTermDays / creditLimit without ` +
        `assertCan(actor, "maintain", "Maintenance"). Credit terms and ceilings ` +
        `are admin reference data — an \`update Customer\` gate (which ENCODER ` +
        `holds) lets the cashier raise the ceiling that should stop them.`
    );
  }
  if (!bad) pass("R8  every credit-field write is gated on maintain Maintenance");
}

// ══════════════════════════════════════════════════════════════════════════
// R9 — every service method touching financial data calls assertCan.
// ══════════════════════════════════════════════════════════════════════════

const MONEY_MODULES = /[\\/]modules[\\/](customers|sales-audit|job-orders|delivery-receipts)[\\/]services[\\/]/;

function checkR9() {
  let bad = 0;
  for (const file of walk(SRC, /\.ts$/).filter((f) => MONEY_MODULES.test(f))) {
    const src = readFileSync(file, "utf8");
    const re = /\b_actor\s*:\s*Actor\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      if (optedOut(src, m.index, "R9")) continue;
      bad++;
      fail(
        "R9",
        file,
        lineAt(src, m.index),
        `method takes \`_actor\` — it receives the actor and never checks it. ` +
          `Reads of credit limits, TINs, sales history and profile attachments ` +
          `need assertCan too.`
      );
    }
  }
  if (!bad) pass("R9  no service method discards its actor on financial data");
}

// ══════════════════════════════════════════════════════════════════════════
// R11 — voiding is not deleting. A receipt is never soft-deleted to hide it.
// ══════════════════════════════════════════════════════════════════════════

function checkR11() {
  let bad = 0;
  for (const file of walk(SRC, /\.ts$/)) {
    const src = readFileSync(file, "utf8");
    for (const model of VOIDABLE) {
      const re = new RegExp(
        `prisma\\.${model}\\.update(Many)?\\s*\\(`,
        "g"
      );
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        const block = blockAt(src, m.index + m[0].length - 1);
        if (!/deletedAt\s*:\s*new Date\(\)/.test(block)) continue;
        if (optedOut(src, m.index, "R11")) continue;
        bad++;
        fail(
          "R11",
          file,
          lineAt(src, m.index),
          `soft-deletes a ${model}. A spoiled receipt keeps its row and its ` +
            `serial — set voidType / voidReason / voidedAt / voidedById instead. ` +
            `Deleting it leaves a gap in booklet accountability.`
        );
      }
    }
  }
  if (!bad) pass("R11 receipts are voided in place, never soft-deleted");
}

// ══════════════════════════════════════════════════════════════════════════
// R15 — a company credit ceiling is company-wide.
// ══════════════════════════════════════════════════════════════════════════

// Structural, not textual: the A/R aggregation must have a company roll-up. If
// exposure is only ever keyed by customerId, a company's ceiling is silently
// multiplied by its contact count.
function checkR15() {
  const file = join(SRC, "modules", "sales-audit", "services", "receivable-service.ts");
  let src: string;
  try {
    src = readFileSync(file, "utf8");
  } catch {
    fail("R15", file, 0, "receivable-service.ts not found — cannot verify company roll-up.");
    return;
  }
  if (/companyId/.test(src)) {
    pass("R15 A/R exposure rolls up by company, not just by contact");
  } else {
    fail(
      "R15",
      file,
      1,
      `A/R exposure never references companyId. Company.creditLimit is pushed ` +
        `onto every contact by syncBillingToContacts, so aggregating per ` +
        `customer multiplies the ceiling by the contact count — a company with ` +
        `a ₱100k limit and 5 contacts carries ₱500k.`
    );
  }
}

// ══════════════════════════════════════════════════════════════════════════

console.log("\nSales & Finance Contract — docs/sales-contract.md\n");
checkR1();
checkR2();
checkR8();
checkR9();
checkR11();
checkR15();

// ── report ─────────────────────────────────────────────────────────────────

const counts = new Map<string, number>();
for (const v of found) counts.set(v.key, (counts.get(v.key) ?? 0) + 1);

if (UPDATING) {
  writeFileSync(
    BASELINE,
    JSON.stringify(
      {
        note:
          "Known Sales & Finance Contract debt, recorded so the scanner can " +
          "ratchet: these do not fail the build, anything NEW does. Values are " +
          "occurrence counts — exceeding one fails, so debt can shrink but never " +
          "grow. See docs/sales-contract.md. Regenerate with --update-baseline " +
          "only after FIXING violations, never to silence new ones.",
        generated: new Date().toISOString().slice(0, 10),
        violations: Object.fromEntries([...counts].sort(([a], [b]) => (a < b ? -1 : 1))),
      },
      null,
      2
    ) + "\n"
  );
  console.log(
    `\nBaseline written: ${rel(BASELINE)} — ${found.length} known violation(s) ` +
      `across ${counts.size} signature(s).\n`
  );
  process.exit(0);
}

// Within a signature, the first N are grandfathered and the rest are new.
const fresh: Violation[] = [];
const debt: Violation[] = [];
const remaining = new Map(baseline);
for (const v of found) {
  const left = remaining.get(v.key) ?? 0;
  if (left > 0) {
    remaining.set(v.key, left - 1);
    debt.push(v);
  } else {
    fresh.push(v);
  }
}

if (fresh.length) {
  console.error(`\n── NEW violations (${fresh.length}) ────────────────────────────────\n`);
  for (const v of fresh) {
    console.error(`  ✗ ${v.rule}  ${rel(v.file)}:${v.line}`);
    console.error(`      ${v.msg}\n`);
  }
}

if (debt.length) {
  const byFile = new Map<string, number>();
  for (const v of debt) byFile.set(rel(v.file), (byFile.get(rel(v.file)) ?? 0) + 1);
  console.log(`\n── known debt (${debt.length}, not blocking) ──────────────────────\n`);
  for (const [file, n] of [...byFile].sort((a, b) => b[1] - a[1]))
    console.log(`     ${String(n).padStart(3)}  ${file}`);
}

const ok = fresh.length === 0;
console.log(
  `\n${ok ? "PASS" : "FAIL"} — ${passes} rule${passes === 1 ? "" : "s"} clean, ` +
    `${fresh.length} new violation${fresh.length === 1 ? "" : "s"}, ` +
    `${debt.length} known.\n`
);

if (!ok) {
  console.error(
    "Each violation maps to a numbered rule in docs/sales-contract.md, which\n" +
      "explains the defect it prevents. If a hit is a genuine exception, opt out\n" +
      "on the line above with a reason:\n\n" +
      "  // contract:allow R2 — the void ledger must see voided rows by definition\n\n" +
      "Do NOT run --update-baseline to clear a new hit. The baseline records debt\n" +
      "that predates the contract; silencing fresh violations with it defeats the\n" +
      "whole mechanism.\n"
  );
}
process.exit(ok ? 0 : 1);
