# Chart of Accounts

**Authored and owned by the Finance / AR track. Ready to use.**

The machine-readable source of truth is
[`src/lib/chart-of-accounts.ts`](../src/lib/chart-of-accounts.ts) — pure typed
data with no Prisma import, usable before the `Account` model exists. This file
explains it.

144 accounts, 119 of them postable. Built for a Philippine printing shop:
offset, digital, large-format, newspaper, walk-in services and merchandise, with
BIR VAT and withholding-tax handling built into the structure rather than bolted
on later.

---

## How to use it

**Ledger & Payables track** — seed `Account` rows from `CHART_OF_ACCOUNTS`, then
post against the codes. Everything you need for bills, vouchers, expenses,
disbursements, fixed assets and the payroll journal import is already here and
marked `owner: "ap"`.

```ts
import {
  CHART_OF_ACCOUNTS,
  ACCOUNT,
  validateChart,
} from "@/lib/chart-of-accounts";

// In the seed — run validateChart() first and abort on any error. A typo in a
// `parent` code silently drops a whole branch out of the balance sheet, and
// nothing downstream would catch it.
const errors = validateChart();
if (errors.length) throw new Error(errors.join("\n"));

for (const a of CHART_OF_ACCOUNTS) { /* upsert by code */ }
```

**Everyone posting** — reference accounts through the `ACCOUNT` handles, not
magic strings:

```ts
lines: [
  { account: ACCOUNT.AR_TRADE,    debit:  "11200.00", customerId },
  { account: ACCOUNT.SALES_...,   credit: "10000.00" },
  { account: ACCOUNT.OUTPUT_VAT,  credit:  "1200.00" },
]
```

**Nobody edits the file to add an account they happen to need.** Request it from
the Finance track. An account added in isolation lands outside the rollup tree,
and the statement it belongs to quietly stops footing.

---

## The code scheme

Four digits, grouped by statement position:

| Range | Group | Statement |
|---|---|---|
| `1xxx` | Assets | Balance Sheet |
| `2xxx` | Liabilities | Balance Sheet |
| `3xxx` | Equity | Balance Sheet |
| `4xxx` | Revenue | Profit & Loss |
| `5xxx` | Cost of Sales | Profit & Loss |
| `6xxx` | Operating & Other Expenses | Profit & Loss |

A code ending in `00` is a **header** — a rollup node, never postable. The
posting engine rejects a journal line against one. Postable accounts sit
underneath.

`normalBalance` is stated explicitly rather than derived, because **contra
accounts invert it**: Accumulated Depreciation is an `ASSET` carrying a `CREDIT`
balance; Sales Discounts is `REVENUE` carrying a `DEBIT` one. `validateChart()`
enforces that any account inverting its type is marked `isContra`.

---

## Why the structure is shaped this way

Six decisions that are deliberate, and that a well-meaning refactor would
otherwise undo.

### Cost of Sales (5xxx) is separate from Operating Expenses (6xxx)

So gross margin is readable. For a print shop, "did our pricing cover what the
job actually cost?" is a different question from "are our overheads under
control", and merging them into one expense block hides the first one. This is
the split that makes per-job margin possible at all.

### Work in Process (1180) carries the `jobOrderId` dimension

Materials released to a job debit WIP, not Cost of Sales. Completion clears WIP
to `5xxx`. Because every WIP line carries its job order, "what did JO-ORM-2608-00123
cost us?" is one query rather than a reconstruction — and that is the number
the shop lives on.

### Tax withheld from us is an asset, not a discount — and there are TWO of them

When a customer pays ₱110,000 on a ₱112,000 charge invoice and hands over a BIR
2307, the missing ₱2,000 is **tax already remitted on our behalf**. It debits
1160, the receivable closes to zero, and the balance is claimed against income
tax. Without the account, that ₱2,000 sits in A/R forever.

**Government, LGU and public-school customers withhold twice**, on two forms:

| Account | Rate | Form | Credited against |
|---|---|---|---|
| `1160` Creditable Withholding Tax Receivable | 1% goods / 2% services | **2307** | Income tax |
| `1161` Creditable Withholding VAT | 5% | **2306** | Output VAT (2550M/Q) |

Both rates apply to the **VAT-exclusive** amount. A ₱112,000 LGU job: base
₱100,000, so ₱2,000 income tax + ₱5,000 VAT withheld, and they pay ₱105,000.
Since 1 Jan 2021 the 5% is creditable rather than final (RMC 36-2021), which is
why `1161` is an asset rather than a cost.

Keep the two apart. Merged into one figure they still close the receivable, and
the accountant is still left unable to split them across two returns.

Do not confuse either with **2140 Withholding Tax Payable — Expanded**, which is
EWT *we* withhold from suppliers and remit on 1601-EQ. Opposite direction,
opposite sign.

### Customer Advances (2120) is a liability, never netted against A/R

Money we hold *for* a customer is the opposite sign to money they owe us.
Netting the two understates receivables and lets a customer with a large credit
appear to be under their limit when they are not. The A/R ledger reports the two
side by side. This mirrors `R6` in the sales contract.

**2121 Customer Deposits — Job Order Downpayments** — **decided 2026-08-19**:
the JO slip is an *acknowledgement receipt*, not a sale, so a downpayment credits
this liability and books no revenue. It is drawn down when the invoice is issued.

### 1142 Unbilled Receivables is the middle state, and it matters

A job order's value passes through three states. Only two of them touch the
ledger, and conflating them is what makes a month look good because an order was
*taken* rather than because work was *done*.

| State | Customer account view | Ledger |
|---|---|---|
| In production, not delivered | **Backlog** — shown as owed | **Nothing.** Not earned. |
| Delivered, not yet invoiced | **Unbilled** | Dr `1142`, Cr Revenue |
| Invoiced | **A/R**, aged, with a due date | Dr `1140`, Cr Revenue *(clears `1142`)* |

`1142` carries both `customerId` and `jobOrderId`. Delivery is the trigger —
`JobOrderItem.qtyDelivered`, which DR issuance already maintains.

A customer's total exposure is the sum of all three, **reported as three lines
and a total**. Merge them and both the aging report and the credit-limit check
stop meaning anything: backlog has no due date to age against, and no credit has
been extended on work that has not been billed.

### Revenue Deductions (4300) are contra-revenue, not negative sales

Sales Returns (4310), Sales Discounts (4320) and Senior Citizen / PWD Discounts
(4330) each get their own account and are shown *below* gross sales rather than
netted into it. BIR reporting and the accountant both want gross and the
deductions apart.

**4330 is separate from 4320 on purpose.** The statutory senior-citizen and PWD
discount is 20% and carries a VAT exemption; it is reported separately and must
never be merged into ordinary negotiated discounts.

### Revenue splits VAT (4100) from Non-VAT (4200) at the top

The `IN` and `NV` series post to different branches, so the two never blend and
either can be reported alone. This pairs with the `LedgerScope` field on every
journal entry.

**Decided 2026-08-19.** The `NV` booklets are **not** BIR-registered, so the
whole `4200` branch posts with `LedgerScope.INTERNAL` — it appears in management
reports and never in anything handed to the accountant. The `IN` series posts as
`BOTH`.

Note the distinction that survives: OPS Fusion is not a registered book of
account, but the `IN` booklets *are* registered documents. VAT arithmetic and
serial accountability on that series still have to be right.

---

## The groups at a glance

### 1xxx Assets

| Code | Account | Notes |
|---|---|---|
| 1110–1130 | Cash on Hand, Petty Cash, Undeposited Collections, Cash in Bank, GCash | One postable sub-account per real bank account, mapped 1:1 to a `CashAccount`. `1112 Undeposited Collections` is what `ReconciliationDay.depositAmount` clears. |
| 1140–1145 | A/R Trade, A/R Non-Trade, **Unbilled Receivables**, Allowance for Doubtful Accounts | 1140 carries `customerId` — the GL side of the aging report. **1142** is delivered-but-not-invoiced work; see above. |
| 1160–1166 | Creditable Withholding Tax Receivable, **Creditable Withholding VAT**, Input VAT, Deferred Input VAT | Tax assets. 1160 is income tax (2307); 1161 is the 5% VAT (2306). Never merged. |
| 1171–1175 | Inventory by category | Mirrors `Material.category` so the stock ledger maps cleanly |
| 1180 | Work in Process | Carries `jobOrderId` |
| 1191–1193 | Prepaid rent, insurance, taxes | |
| 1210–1260 | Fixed assets with paired accumulated depreciation | Printing equipment, office, furniture, vehicles, leasehold |

### 2xxx Liabilities

| Code | Account | Notes |
|---|---|---|
| 2110–2115 | A/P Trade, A/P Non-Trade, Goods Received Not Invoiced | 2110 carries `supplierId`. GRNI closes the gap between stock arriving and the bill arriving. |
| 2120–2121 | Customer Advances, Customer Deposits | See above |
| 2130–2133 | Output VAT, Deferred Output VAT, VAT Payable, Percentage Tax Payable | |
| 2140–2142 | Withholding Tax Payable — Expanded / Compensation / Final | 1601-EQ, 1601-C |
| 2150–2153 | Salaries Payable, SSS, PhilHealth, Pag-IBIG | Posted from the payroll journal import |
| 2160–2210 | Accrued expenses, loans current and non-current | |

### 3xxx Equity

Owner's Capital, Owner's Drawings (contra), Retained Earnings, Income Summary.
Retained Earnings is rolled by the year-end closing entry and never posted to by
hand during the year. Income Summary is a clearing account — zero at every
moment except during close.

### 4xxx Revenue

Service lines under 4100 (VAT): offset, digital, large format, newspaper,
photocopy and walk-in, finishing and bindery, supplies and merchandise, plus
zero-rated and VAT-exempt. Non-VAT under 4200. Deductions under 4300. Other
income under 4900.

Because revenue is split by service line at the account level, "sales by
product category" comes straight off the trial balance — no join back to
`JobOrderItem` needed.

### 5xxx Cost of Sales

Materials used by category (mirroring the inventory accounts), Direct Labor,
Subcontracted Printing, Production Overhead, Freight In, Spoilage & Rework,
Inventory Variance.

**5600 Spoilage & Rework** gets its own account deliberately — for a print shop
it is a quality metric as much as a cost, and burying it in materials hides it.

### 6xxx Operating & Other Expenses

Grouped as Personnel (6100), Occupancy (6200), Repairs & Maintenance (6300),
Selling & Distribution (6400), Administrative (6500), Depreciation &
Amortization (6600), Other (6900).

**6590 Miscellaneous Expense should stay small.** A large balance there means an
account is missing — that is the signal to request one.

---

## Multi-branch

A second branch (Tacloban) is planned with a branch switcher — standing in Ormoc
you see only Ormoc. That is a **scoped view over one ledger**, not separate books:
**this chart stays single**, and `branchId` is a dimension on `JournalEntry`.

Not being built yet. The column is reserved now because adding it later means
backfilling and guessing which branch historical rows belonged to. See
[`ledger-interface.md`](ledger-interface.md).

---

## Before go-live

Two things the Ledger track must do with this chart, neither of which is a
developer decision alone:

1. **Reconcile it against the QuickBooks export.** This chart is built for the
   business, not copied from their current file. Map every QuickBooks account to
   a code here; anything that will not map is either an account we are missing or
   one they no longer need. Take the differences to the accountant.
2. **Load opening balances as at the cutover date.** Every balance-sheet account
   needs its opening figure posted as a single dated journal entry, and the
   entry must balance. This is a design problem, not an afterthought.

---

## Validation

`validateChart()` is pure and takes no I/O — run it in the seed, and again in
`scripts/verify-ledger.ts`. It catches:

- duplicate account codes
- a `parent` code that does not exist (an orphan branch)
- an account parented to a postable account instead of a header
- a child whose `type` disagrees with its parent's
- an account inverting its type's normal balance without `isContra`

It found one real error in this chart's first draft. Keep it in the loop.
