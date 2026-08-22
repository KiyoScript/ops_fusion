# Accounts Payable & General Ledger — Track Brief

**You are the developer (or the AI assisting the developer) who owns this
track. This document is your starting point and your boundary. Read it fully
before writing any code.**

This is deliberately *not* a complete specification. It defines your scope, the
rules that bind you, the order to work in, and what you must investigate for
yourself. Where it says **INVESTIGATE**, that is your job — go read the running
system, read the legacy behaviour, and produce the design. Where it says
**DO NOT DECIDE ALONE**, stop and ask the shop owner or their accountant.

---

## 0. How to use this document

Work through it in order. For each phase:

1. Read the phase goal and the INVESTIGATE items.
2. Produce a **Blueprint-format design document** (schema / ERD / workflows /
   roles) and get it approved *before* writing code. This is a house rule from
   `AGENTS.md`, not a suggestion.
3. Build it.
4. Ship a green end-to-end verify script. That is the definition of done.

Do not skip ahead. Phase A is infrastructure every later phase sits on, and the
AR track is blocked on it.

---

## 1. What OPS Fusion is, and why this track exists

OPS Fusion is the ERP for **Ormoc Printshoppe** — read `AGENTS.md` for the full
picture. It currently tracks money coming IN (invoices, collections,
receivables) in real depth, and money going OUT not at all.

There is **no general ledger, no chart of accounts, no expense record, no
supplier bill, and no bank account** anywhere in the system. The goal of this
track is to close that gap so the shop can retire QuickBooks entirely.

Two tracks are running in parallel:

| Track | Owner | Scope |
|---|---|---|
| **Ledger & Payables** | **you** | Chart of Accounts, General Ledger, Fiscal Periods, Cash & Bank, Expenses, Supplier Bills, Disbursements, purchase-side tax working papers, financial statements |
| **Finance / AR** | the shop owner's track | Invoicing, Collections, Receivables, Withholding Tax received, customer credit, sales-side tax working papers |

They meet at the General Ledger. **You build it, they consume it.**

---

## 2. Your scope

You own these paths outright. Create them; nobody else touches them.

```
prisma/schema/account.prisma
prisma/schema/journal.prisma
prisma/schema/fiscal-period.prisma
prisma/schema/cash-account.prisma
prisma/schema/payable.prisma
prisma/schema/expense.prisma

src/modules/ledger/**       (chart of accounts, journals, periods, statements)
src/modules/payables/**     (suppliers as payees, bills, vouchers, expenses)

src/lib/ability/policies/ledger.ts
src/lib/ability/policies/payables.ts

src/app/(app)/ledger/**
src/app/(app)/payables/**
src/app/(app)/maintenance/ledger/**
src/app/api/ledger/**
src/app/api/payables/**

scripts/verify-ledger.ts
scripts/verify-payables.ts
```

Follow the existing module layout exactly — see §5.

## 3. NOT your scope

**Hard boundaries. Do not edit these files.** They belong to the AR/finance
track and editing them creates merge conflicts and financial defects:

```
prisma/schema/sale.prisma
prisma/schema/collection-receipt.prisma
prisma/schema/advance-payment.prisma
prisma/schema/booklet.prisma
prisma/schema/audit.prisma

src/modules/sales-audit/**
src/modules/quotations/**
src/lib/ability/policies/sales-audit.ts
docs/sales-contract.md
```

Also not yours (core dev): `src/modules/job-orders`,
`src/modules/delivery-receipts`, `src/modules/customers`,
`src/modules/inventory`. You will need to *read* inventory and coordinate on it
in Phase E — read freely, but propose changes rather than making them.

**You do not build payroll.** The shop runs a separate payroll system. You build
the path that imports its output as a journal entry, nothing more.

**A Supplier is not a Customer.** Never reuse the `Customer` model, its
policies, or its attachment table for suppliers. Receivable and payable are
opposite signs; sharing a model makes both reports wrong. A `Supplier` model
already exists in `prisma/schema/inventory.prisma` as item-master metadata —
**INVESTIGATE** whether to extend it or introduce a separate payee entity, and
justify the choice.

---

## 4. Before you write any code — required reading

In this order. Do not start designing until you have read all of it.

| # | Read | Why |
|---|---|---|
| 1 | `AGENTS.md` | House rules, the six legacy systems, the post-pull ritual, definition of done |
| 2 | `CLAUDE.md` | **The code-review-graph MCP tools.** Use `semantic_search_nodes` / `query_graph` / `get_architecture_overview` BEFORE Grep. Faster and cheaper. |
| 3 | `docs/sales-contract.md` | R1–R15. **Every rule applies to you.** Money is `Decimal`, filter voided rows, no client-side totals over a paginated slice, `assertCan` on every method including reads. |
| 4 | `docs/ledger-interface.md` | **The contract you are implementing.** The frozen posting API, the models, the posting rules, the reporting-scope split. |
| 4b | `docs/chart-of-accounts.md` + `src/lib/chart-of-accounts.ts` | **The Chart of Accounts, delivered to you ready to use.** 144 accounts, every payables/expense/fixed-asset account you need already in it. You seed from it; you do not design it. See §5a. |
| 5 | `prisma/schema/sale.prisma`, `collection-receipt.prisma`, `advance-payment.prisma` | The subledgers you post from. Read the comments — they carry the reasoning. |
| 6 | `src/modules/sales-audit/services/money.ts` | Integer-centavo arithmetic. **Reuse it. Do not write your own.** |
| 7 | `src/modules/sales-audit/services/receipt-service.ts` | The reference implementation for a financial service: transactions, `assertCan`, activity logging, void handling |
| 8 | `src/modules/inventory/**` | `StockLedgerEntry` is an append-only ledger with `unitCost` — the closest existing thing to what you are building, and the source of your inventory postings |
| 9 | `prisma/schema/material-request.prisma` | The stock-OUT path (`MaterialRequestLine.unitCostAtRequest`) — your job-costing input |
| 10 | `scripts/verify-sales-audit.ts` | The verify-script pattern yours must match |

### Then: INVESTIGATE and report before designing

Produce a short findings document covering:

1. **What the shop currently does in QuickBooks.** Which reports they actually
   run monthly, which they send to their accountant, and which they ignore.
   Build for what they use.
2. **Their current QuickBooks Chart of Accounts.** Export it and **reconcile it
   against the delivered chart** (`src/lib/chart-of-accounts.ts`). Map every
   QuickBooks account to a code; anything that will not map is either an account
   we are missing or one they no longer need. Take the differences to the
   Finance track and the accountant — do not resolve them by editing the chart.
3. **Their opening balances.** Cutting over means loading balances as at a
   cutover date, as one balanced dated journal entry per balance-sheet account.
   Design that migration; it is not an afterthought.
4. **Existing suppliers, terms and payment habits.** Do they pay on statement or
   per invoice? Cheques, cash, bank transfer? Post-dated cheques?
5. **Whether they are a designated withholding agent, and at what rates** — this
   drives `2140` and the 2307s the shop issues to suppliers.

### Already decided — do not re-open these

Settled with the owner on 2026-08-19. They are recorded here so you do not spend
a week investigating a question that has an answer.

- **OPS Fusion will NOT be BIR-registered.** It is an internal management
  system. No CAS registration, no loose-leaf book formats, no SLSP output, no
  BIR return forms generated from here. Your Phase F shrinks accordingly — you
  produce *working papers for the accountant*, not filings.
  **But** the `IN` invoice booklets are still registered documents, so VAT
  arithmetic and Input VAT tracking still have to be right.
- **The `NV` booklets are not registered** — that branch posts `INTERNAL`.
- **Fiscal year is the calendar year.** Jan 1 – Dec 31.
- **Target cutover is 1 January 2027**, with QuickBooks run in parallel through
  Q1 2027 and retired once the trial balances agree for three consecutive
  months. Design the opening-balance load against that date.
- **The `JO_SLIP` is a customer deposit, not revenue** — see
  `docs/ledger-interface.md`. Relevant to you only because it means `2121` is a
  live account, not a dormant one.
- **Multi-branch: reserve `branchId`, build nothing.** See §5b.

---

## 5a. The Chart of Accounts is delivered — do not design one

`src/lib/chart-of-accounts.ts` is authored and owned by the **Finance / AR
track**. It is pure typed data with no Prisma import, so it works before your
`Account` model exists. 144 accounts, 119 postable, with every payables,
expense, tax and fixed-asset account you need already in place and tagged
`owner: "ap"`.

Your job is to seed it and post against it:

```ts
import { CHART_OF_ACCOUNTS, ACCOUNT, validateChart } from "@/lib/chart-of-accounts";

// Run this FIRST in the seed and abort on any error. A typo in a `parent` code
// silently drops a whole branch out of the balance sheet and nothing else
// catches it. It already found one real bug in the chart's first draft.
const errors = validateChart();
if (errors.length) throw new Error(errors.join("\n"));

for (const a of CHART_OF_ACCOUNTS) { /* upsert Account by code */ }
```

Reference accounts through the `ACCOUNT` handles (`ACCOUNT.AP_TRADE`,
`ACCOUNT.GRNI`, `ACCOUNT.EWT_PAYABLE`), never a bare `"2110"` in a service.

**Do not edit that file to add an account you happen to need.** Request it from
the Finance track. An account added in isolation lands outside the rollup tree
and the statement it belongs to quietly stops footing. If `6590 Miscellaneous
Expense` is growing, that is the signal an account is missing — ask for it.

Two payables-side details already decided for you, so you do not rediscover them:

- **`1160` and `2140` are opposite things.** `1160 Creditable Withholding Tax
  Receivable` is EWT customers withhold from *us* (their 2307s, an asset).
  `2140 Withholding Tax Payable — Expanded` is EWT *we* withhold from suppliers
  and remit on 1601-EQ (a liability). Never merge them.
- **`2115 Goods Received Not Invoiced`** is your bridge between receiving and
  the bill: receiving debits Inventory and credits GRNI; the supplier bill
  clears GRNI to `2110 Accounts Payable`.

Read `docs/chart-of-accounts.md` for the reasoning behind each group.

## 5b. Multi-branch — reserve the column, build nothing

The shop plans a second branch (Tacloban) with a branch switcher: standing in
Ormoc you see only Ormoc. **That is not on the roadmap yet and you are not
building it.**

What you *are* doing, in Phase A:

- Add a `Branch` model with two rows (Ormoc, Tacloban).
- Put `branchId` on `JournalEntry`, defaulted to Ormoc.
- Same for `Bill`, `PaymentVoucher` and any expense record you create.

Nothing else. No switcher, no per-branch booklet series, no consolidated
reporting, no branch filter on any screen.

**Why the column goes in before the feature:** a defaulted column on an empty
table costs an hour. The same column added after fifty thousand journal entries
means backfilling and *guessing* which branch historical rows belonged to.

Note that `BRANCH_CODE = "ORM"` is currently a hardcoded constant in five
service files — job orders, delivery receipts, material requests, stock
adjustments, cycle counts. Those are core-dev files: raise the change, do not
make it.

## 5. Architecture you must follow

Non-negotiable. Match the existing codebase — the reviewers will hold you to it.

**Module layout** — `src/modules/<module>/{components,services,repositories,schemas,hooks}`

- **Repositories hold ALL Prisma calls.** No `prisma.` outside a repository.
  Pattern: `src/modules/sales-audit/repositories/booklet-repository.ts` — a
  `select` const, a `Prisma.XGetPayload` record type, an exported interface,
  then the implementation.
- **Services hold logic + `assertCan`.** Every method, including reads (`R9`).
- **Schemas** are Zod. Validation at the boundary.
- **Permissions** — one CASL policy file per resource in
  `src/lib/ability/policies/`, registered in `policies/index.ts`. That registry
  line is the only shared file you touch.

**Prisma schema** — folder-based, `prisma/schema/`, one file per domain, enums
beside their owning model.

**Feature flags** — add your modules to `MODULE_KEYS` and `MODULES` in
`src/lib/modules.ts` so the shop can run with them off. `defaultEnabled: false`
until the module is proven.

**Data discipline** — qty = `Int`; money = `Decimal` with explicit scale
(`(12,2)` for document figures, `(14,2)` for GL amounts, `(12,4)` for per-unit
costs); soft deletes via `deletedAt` **except** journal entries, which are never
deleted; one `ActivityLog` row per mutation with a *specific* action name
(`post-journal`, `void-bill`, `close-period` — never a generic `update`).

**Numbering** — follow the house convention `PREFIX-BRANCH-YYMM-#####`, e.g.
`PV-ORM-2608-00042`. See how `MaterialRequest.number` and `JobOrder.joNumber`
are generated.

**Money arithmetic** — integer centavos via `toCentavos` / `toAmount`. Never a
float, never a JS `number` for a stored amount.

---

## 6. The phases

### Phase A — Chart of Accounts + General Ledger core

**The AR track is blocked on this. Ship it first, and ship it small.**

Goal: an `Account` tree, a `JournalEntry` / `JournalLine` pair, `FiscalPeriod`
open/close, and a working `LedgerPoster` implementing the frozen interface in
`docs/ledger-interface.md` exactly.

Also: a **manual journal entry screen** — the accountant's adjusting entries
have to go somewhere — and **Trial Balance** + **General Ledger** reports.
Without those two reports neither track can verify its own work.

The Chart of Accounts is **already delivered** (§5a) — seed it, do not design
it. What you build here is the machinery around it.

- **INVESTIGATE**: how the rollup tree maps onto the statement layouts the
  accountant expects; how opening balances get loaded at cutover.
- **DO NOT DECIDE ALONE**: whether the fiscal year is the calendar year, and the
  cutover date.
- **Done when** `scripts/verify-ledger.ts` proves: entries balance; unbalanced
  postings are rejected; closed periods reject postings; re-posting the same
  source is idempotent; a reversal mirrors without mutating the original.

### Phase B — Cash & Bank accounts

Goal: `CashAccount` (cash on hand, bank accounts, e-wallets), fund transfers
between them, a cash position view, and **bank reconciliation** — matching
system entries against a bank statement.

- Note `ReconciliationDay.depositAmount` in `prisma/schema/audit.prisma` — the
  shop's daily deposit already gets recorded, with no account to land in. That
  is your integration point. **Read that file; do not edit it.** Coordinate the
  change with the AR track.
- **INVESTIGATE**: how many bank accounts, which banks, whether statements can
  be exported as CSV/OFX for import matching.

### Phase C — Expenses & disbursements

Goal: record money going out that has no supplier bill — rent, utilities, fuel,
repairs, permits. Plus a **petty cash fund** with replenishment, and an approval
workflow (spend over ₱X needs a manager).

This is the phase that most directly replaces day-to-day QuickBooks use. It is
deliberately before Bills, because it is simpler and delivers value fastest.

- **INVESTIGATE**: their expense categories (these become expense accounts);
  their current approval practice; petty cash float size.

### Phase D — Supplier Bills (Accounts Payable proper)

Goal: `Bill` → `PaymentVoucher` → `BillPayment`. AP aging. Supplier statements.
Cheque register including **post-dated cheques**. Debit memos for returns.

Mirror the AR side's proven shapes rather than inventing new ones — an
allocation table like `CrAllocation`, an open balance computed as
`amount − paidAmount` and never inferred from a status enum (`R3`), void-not-
delete (`R11`).

**EWT you withhold**: when the shop pays a supplier it may withhold 1%/2% and
issue that supplier a BIR 2307. Model it on the payment, not the bill.

- **INVESTIGATE**: whether they are a designated withholding agent, and at what
  rates.

### Phase E — Purchasing seam (PR → PO → Receiving)

Goal: close the chain into AP. Per `AGENTS.md` this is part of the MACWebApp
fusion and belongs to **core dev**, not you — but the supplier-invoice end is
yours. Coordinate; do not build their half.

The seam: a supplier invoice references the PO and the receiving record, and
may link to a JO. Receiving posts Dr Inventory / Cr Goods-Received-Not-Invoiced;
the bill clears GRNI to Accounts Payable.

- **INVESTIGATE**: read `BeMore/MACWebApp` (sibling repo) for the legacy
  purchasing behaviour. Legacy behaviour 1:1 — nothing less, nothing more.

### Phase F — Tax working papers, purchase side

**Rescoped 2026-08-19 — smaller than it looks.** OPS Fusion is not a registered
book of account, so this phase produces **working papers the accountant uses**,
not filings in a BIR-prescribed layout.

Goal: a purchases register, a cash-disbursements register, an Input VAT summary,
and a record of the 2307s the shop issues to suppliers — each over a custom date
range and exportable to XLSX.

- **INVESTIGATE**: ask the accountant what they actually want handed to them.
  Match that, not a form layout.

### Phase G — Period close & financial statements

Goal: month-end and year-end close, closing entries, retained earnings roll,
and the statements — **Profit & Loss, Balance Sheet, Cash Flow, Trial Balance**
— each runnable in BIR scope and Management scope (see
`docs/ledger-interface.md`). XLSX export for all of them; the repo already has
`exceljs` and `src/lib/spreadsheet.ts`.

This is the phase where QuickBooks actually gets switched off.

---

## 7. What you owe the AR track, and when

They can stub against the interface, but cannot ship past their Phase 2 without
real implementations. In priority order:

1. `LedgerPoster` + `Account` + a seeded Chart of Accounts — **blocking, Phase A**
2. `FiscalPeriod` with open/close — **Phase A**
3. `CashAccount` — **Phase B**
4. Trial Balance + General Ledger reports — **Phase A**

**Freeze the `LedgerPoster` signature in week one and publish it**, even if it
throws `NotImplemented` behind the scenes. That single act is what lets both
tracks build in parallel.

---

## 8. Decisions you must NOT make alone

Stop and ask the shop owner or their accountant:

1. **Any change to the Chart of Accounts.** It is delivered and owned by the
   Finance track (§5a). Request additions; never edit the file.
2. **Inventory valuation method** — the stock ledger currently posts at the
   `unitCost` on the movement. Whether that is intended as moving-average,
   FIFO, or standard cost has never been decided, and it changes both COGS and
   the balance sheet. **This is the biggest one still open on your side.**
3. **Whether the shop is a designated withholding agent**, and at what rates.
4. **Approval thresholds for disbursements** — what amount needs a manager.
5. **Anything that changes a financial rule** — how a total is computed, when
   credit is checked, what gates a disbursement. Say so explicitly in the PR and
   tag the finance track.

Questions 1, 3, 5 and 6 of the original list are now answered — see
*Already decided* in §4.

---

## 9. Definition of done

Per `AGENTS.md`, for every phase:

```
npx tsx scripts/verify-ledger.ts     # your end-to-end script, green
npx tsx scripts/verify-payables.ts   # green
npm run check                        # typecheck + lint + sales contract scanner
```

`npm run check` runs `scripts/verify-sales-contract.ts`, which **ratchets**:
known pre-existing violations are recorded as counts in
`scripts/sales-contract-baseline.json` and pass; anything beyond them fails.
**Never run `--update-baseline` to clear a fresh hit** — that hides your own
bug. Fix it, or opt out in place with a justification:

```ts
// contract:allow R2 — booklet accountability counts leaves, not revenue
```

A bare `contract:allow` with no reason does not satisfy the scanner.

Also required: `npx tsc --noEmit` clean, ESLint clean, and a Blueprint-format
design document approved before the code.

---

## 10. The ritual after every `git pull` that brings schema changes

Symptoms of skipping it: build errors like "Export X doesn't exist in
`@/generated/prisma/enums`", `PrismaClientValidationError` "Unknown field", or
404s on routes that worked before.

```
npx prisma migrate dev     # apply new migrations
npx prisma generate        # regenerate the client (not reliably automatic)
# stop the dev server, then:
rm -rf .next && npm run dev
```

The running dev server holds the OLD Prisma client in memory. Regenerating
alone is not enough — always restart it.

---

## 11. First three things to do

1. Read everything in §4, in order — including the delivered Chart of Accounts.
2. Produce the findings document from §4's INVESTIGATE list — especially the
   QuickBooks account reconciliation and the list of reports the shop actually
   uses.
3. Publish the frozen `LedgerPoster` signature so the AR track can start.

Then design Phase A and get it approved.
