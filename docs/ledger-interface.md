# Ledger Interface — the seam between the books and everything else

**Jointly owned. Neither track changes this file alone.**

OPS Fusion is growing a double-entry General Ledger. Two tracks meet at it:

- The **Ledger/Payables track** BUILDS it — Chart of Accounts, Journal Entries,
  Fiscal Periods, the posting engine, and Accounts Payable on top.
- The **Finance/AR track** CONSUMES it — every `Sale`, `CollectionReceipt` and
  `AdvancePayment` posts through the interface defined here.

This file is the contract between them. It is frozen early, on purpose, so the
two tracks build in parallel instead of one waiting on the other.

Read [`docs/sales-contract.md`](sales-contract.md) first. Everything in it still
applies — this file adds the ledger layer underneath it, it does not replace it.

---

## The governing principle

> **Subledgers stay authoritative for operations. The GL is the book of record
> for reporting.**

`Sale`, `CollectionReceipt`, `CrAllocation`, `AdvancePayment`, `Bill`,
`StockLedgerEntry` keep doing exactly what they do today. The counter, the
booklet serials, the A/R aging, the on-hand balance — none of it changes and
none of it starts reading the GL.

What changes is that every money event ALSO emits a balanced journal entry, in
the SAME database transaction that writes the subledger row. If the posting
fails, the operation fails. There is no batch job, no nightly sync, no
"post later" queue. A subledger row without its journal entry is a bug that
makes the trial balance wrong, and it must be impossible to create one.

**Why this way:** the alternative — deriving the GL from the subledgers on
read — cannot represent adjusting entries, depreciation, accruals, or closing
entries, which have no subledger row to derive from. And it leaves the
accountant unable to correct anything. Post-on-event is the only shape that
supports a real set of books.

---

## Models the Ledger track owns

Schema files live in `prisma/schema/`, one file per domain, as the house rules
require. The Ledger track owns these files outright:

| File | Models |
|---|---|
| `prisma/schema/account.prisma` | `Account`, `AccountType`, `NormalBalance` |
| `prisma/schema/journal.prisma` | `JournalEntry`, `JournalLine`, `JournalSource`, `LedgerScope` |
| `prisma/schema/fiscal-period.prisma` | `FiscalPeriod`, `PeriodStatus` |
| `prisma/schema/cash-account.prisma` | `CashAccount` (cash on hand / bank / e-wallet) |
| `prisma/schema/payable.prisma` | `Bill`, `BillLine`, `PaymentVoucher`, `BillPayment`, … |

The AR track does not edit these. The Ledger track does not edit
`sale.prisma`, `collection-receipt.prisma`, `advance-payment.prisma`,
`booklet.prisma`, or `audit.prisma`.

### Non-negotiable shape

These properties are what the AR track is coding against. Changing any of them
is a joint decision, not a refactor.

**`Account`**

- `code` — `String @unique`. The account code is the stable identifier the
  posting API accepts. Callers pass codes, never cuids, so posting rules stay
  readable and survive a re-seed.
- `type` — `ASSET | LIABILITY | EQUITY | REVENUE | EXPENSE`
- `normalBalance` — `DEBIT | CREDIT`. Derived from `type` but stored, because
  contra accounts invert it.
- `isPostable` — `Boolean`. Header/rollup accounts are not postable; the
  posting engine rejects a line against one.
- `parentId` — self-relation, for the rollup tree the financial statements walk.
- Soft delete via `deletedAt`. An account that has ever been posted to is never
  hard-deleted — it is deactivated. History must stay readable.

**`JournalEntry`**

- `entryNo` — `String @unique`, generated, gap-free per fiscal year.
- `entryDate` — `DateTime @db.Date`. The ACCOUNTING date, which is not always
  the created-at date.
- `sourceType` / `sourceId` / `sourceSeq` — what produced it. Together these are
  `@@unique`, which is what makes posting idempotent (see below).
- `scope` — `LedgerScope`, see the reporting-scope section.
- `postedById`, `postedAt`, `memo`.
- `reversedById` / `reversesId` — self-relation. **Entries are immutable.** A
  wrong entry is corrected by a reversing entry, never by an edit or a delete.
  This mirrors `R11` in the sales contract: voiding is not deleting.
- No `deletedAt`. A journal entry cannot be soft-deleted either.

**`JournalLine`**

- `accountId`, `debit` and `credit` — both `@db.Decimal(14,2)`, both defaulting
  to `0`. Exactly one of the two is non-zero per line.
- Subledger dimensions, all nullable: `customerId`, `supplierId`, `jobOrderId`,
  `cashAccountId`. These are what make "A/R by customer" and "cost by job"
  answerable from the GL without joining back to the subledger.
- `memo`, `seq`.

**`branchId` — reserve it now, build nothing.** The shop plans a second branch
(Tacloban) with a branch switcher: standing in Ormoc you see only Ormoc. That is
a *scoped view over one ledger*, not separate books — one Chart of Accounts, one
`JournalEntry` table, a `branchId` dimension, and the switcher setting a filter.

Put `branchId` on `JournalEntry` **now**, defaulted to Ormoc, and add a `Branch`
model with the two rows. Do not build the switcher, per-branch booklet series, or
consolidated reporting yet — none of that is wanted for the first release.

The reason to add the column before the feature: a defaulted column on an empty
table costs an hour; the same column added after fifty thousand journal entries
means backfilling and *guessing* which branch historical rows belonged to. Note
also that `BRANCH_CODE = "ORM"` is currently a hardcoded constant in five service
files (job orders, delivery receipts, material requests, stock adjustments, cycle
counts) — those are core-dev files, so raise the change rather than making it.

**`FiscalPeriod`**

- `year`, `month`, `status` — `OPEN | CLOSED | LOCKED`.
- The posting engine REJECTS any entry whose `entryDate` falls in a period that
  is not `OPEN`. This is the only thing standing between you and someone
  re-opening last year's VAT position after it was filed.

---

## The posting API — the frozen surface

Lives at `src/modules/ledger/services/posting.ts`. This is the ONLY way any
other module touches the GL.

```ts
export type PostingLine = {
  /** Account CODE, not id — e.g. "1200" for Accounts Receivable. */
  account: string;
  /** Decimal string, centavo-exact. Exactly one of debit/credit is non-zero. */
  debit?: string;
  credit?: string;
  memo?: string;
  // — subledger dimensions, all optional —
  customerId?: string;
  supplierId?: string;
  jobOrderId?: string;
  cashAccountId?: string;
};

export type PostingRequest = {
  sourceType: JournalSource; // "SALE" | "COLLECTION_RECEIPT" | "BILL" | ...
  sourceId: string;
  /** Lets one source document post more than one entry. Default 0. */
  sourceSeq?: number;
  entryDate: Date;
  scope?: LedgerScope; // default BOTH
  memo: string;
  lines: PostingLine[];
  actorId: string;
};

export interface LedgerPoster {
  /**
   * Post one balanced entry. MUST be called inside the caller's transaction so
   * the subledger row and its journal entry commit or fail together.
   *
   * Throws when: lines do not balance to the centavo; an account code is
   * unknown or non-postable; the period is not OPEN; a line has both or
   * neither of debit/credit.
   *
   * IDEMPOTENT on (sourceType, sourceId, sourceSeq) — a retry returns the
   * existing entry rather than double-posting.
   */
  post(tx: DbTx, req: PostingRequest): Promise<PostedEntry>;

  /**
   * Reverse everything posted for a source document — the void path. Writes
   * new mirror-image entries dated `on`; never mutates the originals.
   */
  reverse(
    tx: DbTx,
    sourceType: JournalSource,
    sourceId: string,
    input: { on: Date; reason: string; actorId: string }
  ): Promise<PostedEntry[]>;

  /** Read-only: is this document already on the books? */
  isPosted(sourceType: JournalSource, sourceId: string): Promise<boolean>;
}
```

### Rules the engine enforces, not the caller

1. **Balance.** `Σ debit === Σ credit` in integer centavos. Not "close enough".
2. **Period open.** Rejects a posting into a `CLOSED` or `LOCKED` period.
3. **Postable accounts only.** Rollup/header accounts reject lines.
4. **Idempotency** on `(sourceType, sourceId, sourceSeq)`.
5. **Immutability.** No update path exists on `JournalEntry` or `JournalLine`.
   Corrections are reversals.

### Rules the caller is responsible for

1. Passing `tx` — the caller's transaction. A `post()` outside the transaction
   that also writes the subledger row is a bug.
2. Money as decimal STRINGS computed in integer centavos, via `toCentavos` /
   `toAmount` in `src/modules/sales-audit/services/money.ts`. Never a JS
   `number`, never a float. (`R1`.)
3. Calling `reverse()` on every void path.

---

## Reporting scope — the VAT / Non-VAT split

The shop runs two invoice series: `IN` (VAT-registered) and `NV` (non-VAT).
BIR-facing reports must draw on one set of entries; management reports must
draw on everything. So every entry carries:

```prisma
enum LedgerScope {
  BOTH     // BIR-facing books AND management reports. THE DEFAULT.
  INTERNAL // management reports only
}
```

- **Accountant-facing reports** (VAT summary, sales book data):
  `where: { scope: "BOTH" }`
- **Management reports** (real P&L, cash position, job margin): no scope filter.

`BOTH` is the default so that forgetting to set it produces a *complete* report
rather than a quietly short one. An entry only becomes `INTERNAL` when a posting
rule deliberately marks it so.

**DECIDED 2026-08-19.** The `NV` booklets are **not** BIR-registered, so the
whole `4200 Sales — Non-VAT` branch posts as `INTERNAL`. The `IN` series posts as
`BOTH`. This is settled — do not re-litigate it in code review.

### OPS Fusion is not a registered book of account

Also decided: the shop will **not** register OPS Fusion with BIR. It is an
internal management system. That means no CAS registration, no loose-leaf book
formats, no SLSP file output, and no BIR return forms generated from here.

**What that does not change:** the `IN` booklets *are* registered documents.
VAT must still be computed correctly on them, their serial accountability still
matters, and the accountant still needs a clean VAT summary out of this system.
The invoices are real BIR documents; the system simply is not the registered
ledger. Do not collapse those two facts into each other.

---

## Posting rules — who posts what

The Ledger track implements the engine and the payables rules. The AR track
implements the sales rules.

**The Chart of Accounts is already delivered** — `src/lib/chart-of-accounts.ts`,
explained in [`docs/chart-of-accounts.md`](chart-of-accounts.md). It is authored
and owned by the Finance/AR track; neither track edits it to add an account they
happen to need. Reference accounts through the exported `ACCOUNT` handles, never
a bare code string in a service.

### Sales (AR track)

**Cash Sales Invoice — `SI_VAT`**

| | Account | Amount |
|---|---|---|
| Dr | Cash on Hand | `amountPaid` |
| Dr | Accounts Receivable | `amount − amountPaid` *(if partial)* |
| Cr | Sales Revenue | `vatableSales` |
| Cr | Output VAT Payable | `vatAmount` |

**Charge Invoice — `SI_CHARGE`** — same, with the whole `amount` to A/R.
Revenue is booked at point of sale; only the cash timing differs.

**`SI_NON_VAT`** — no Output VAT line. Credit `Sales Revenue — Non-VAT`.
Scope per the accountant's answer above.

**`JO_SLIP` — DECIDED 2026-08-19: an acknowledgement, not a sale.**

The JO slip acknowledges a downpayment on work not yet done. It books **no
revenue**:

| | Account | Amount |
|---|---|---|
| Dr | Cash on Hand | `amountPaid` |
| Cr | Customer Deposits — JO Downpayments (`2121`) | `amountPaid` |

The deposit is drawn down when the invoice is issued: Dr `2121`, Cr Revenue.

The daily sales log keeps showing the cash exactly as it does today — it is a
cash log and that is correct. What must change is that `getDailySummary`
currently adds `JO_SLIP` rows into **`grossSales`**, which overstates revenue by
every downpayment taken that day. The cash belongs in the day's total; it does
not belong in a figure labelled sales.

### Revenue recognition — the three states of a job order

A job order's value moves through three states, and only two of them touch the
ledger. Getting this wrong is what makes a month look good because an order was
*taken*, not because work was *done*.

| State | Customer account view | Ledger |
|---|---|---|
| In production, not delivered | **Backlog** — shown as owed | **Nothing.** Not earned. |
| Delivered, not yet invoiced | **Unbilled** | Dr `1142` Unbilled Receivables, Cr Revenue |
| Invoiced | **A/R**, aged, with a due date | Dr `1140` A/R, Cr Revenue *(clears `1142`)* |

`1142` carries both `customerId` and `jobOrderId`. The customer's total exposure
is the sum of all three lines, reported as three lines and a total — never
merged, or aging and credit limits both stop meaning anything.

Delivery is the trigger for the middle row: `JobOrderItem.qtyDelivered`, which
DR issuance already maintains.

**Collection Receipt** — the extended balancing identity:

```
amount + creditApplied + ewtWithheld + vatWithheld
  =  Σ allocations + creditCreated
```

| | Account | Amount |
|---|---|---|
| Dr | Cash on Hand / Cash in Bank | `amount` |
| Dr | Customer Advances *(liability drawdown)* | `creditApplied` |
| Dr | Creditable Withholding Tax Receivable (`1160`) | `ewtWithheld` |
| Dr | Creditable Withholding VAT (`1161`) | `vatWithheld` |
| Cr | Accounts Receivable | `Σ allocations` |
| Cr | Customer Advances | `creditCreated` |

The two withholding lines are what let a receivable actually close when a
customer pays net of tax. **They are separate accounts on purpose** — they are
two different taxes, evidenced by two different forms, claimed on two different
returns:

| | Rate | Base | Form | Credited against |
|---|---|---|---|---|
| `ewtWithheld` | 1% goods / 2% services | VAT-exclusive | **2307** | Income tax |
| `vatWithheld` | 5% | VAT-exclusive | **2306** | Output VAT (2550M/Q) |

A government, LGU or public-school customer withholds **both at once**: on a
₱112,000 invoice they keep ₱2,000 and ₱5,000 and pay ₱105,000. Merging them
into one figure still closes the receivable and still leaves the accountant
unable to split the ₱7,000 across two returns. Never merge them.

**Both rates apply to the VAT-EXCLUSIVE amount.** Computing either on the gross
over-withholds and leaves the invoice permanently short — see `computeWithholding`
in `src/modules/sales-audit/services/money.ts`.

**Advance Payment (plain advance)** — Dr Cash, Cr Customer Advances.

**Void of any of the above** — `reverse()`. Never an edit.

### Payables & disbursements (Ledger track)

**Supplier Bill** — Dr Expense / Inventory / WIP, Dr Input VAT, Cr Accounts Payable.

**Payment Voucher** — Dr Accounts Payable, Cr Cash in Bank, Cr Withholding Tax
Payable *(EWT the shop withholds from the supplier)*.

**Expense paid directly (no bill)** — Dr Expense, Dr Input VAT, Cr Cash.

**Payroll journal import** — Dr Salaries & Wages / statutory expense accounts,
Cr Cash + statutory payable accounts. Imported from the shop's separate payroll
system; OPS Fusion does not compute payroll.

### Inventory (Ledger track, coordinating with core dev)

`StockLedgerEntry` already carries `unitCost` and `totalValue`, so these
postings are available today:

- `RECEIPT` → Dr Inventory, Cr Accounts Payable / Goods-Received-Not-Invoiced
- `RELEASE` → Dr Work in Process (dimension: `jobOrderId`), Cr Inventory
- `ADJUSTMENT` / `COUNT` → Dr or Cr Inventory Variance

The `jobOrderId` dimension on the WIP line is what makes per-job costing
answerable later. Do not omit it.

---

## What the AR track needs, and when

Ordered by what unblocks the most work. The AR track can build against stubs,
but cannot ship past its Phase 2 without these.

1. **`LedgerPoster` interface + `Account` model + the Chart of Accounts seeded
   from `src/lib/chart-of-accounts.ts`.** Needed FIRST. Everything else waits
   on it. The chart itself is already written — only the model and the seed are
   outstanding.
2. **`FiscalPeriod` with open/close.** Needed before any BIR report is trusted.
3. **`CashAccount`.** Needed for collections to land somewhere real, and for
   bank reconciliation.
4. **Trial balance + General Ledger report.** Needed to prove the AR postings
   are correct — without it neither track can verify its own work.

---

## Verifying

Both tracks. Per `AGENTS.md`, a green end-to-end verify script is the definition
of done.

```
npx tsx scripts/verify-ledger.ts      # Ledger track
npx tsx scripts/verify-sales-audit.ts # AR track — must stay green
npm run check                         # typecheck + lint + sales contract
```

`scripts/verify-ledger.ts` must assert, against a real database:

- A posted entry balances to the centavo.
- An unbalanced request is REJECTED.
- Posting into a `CLOSED` period is REJECTED.
- Re-posting the same `(sourceType, sourceId, sourceSeq)` returns the existing
  entry and does not double-post.
- A reversal produces a mirror entry and leaves the original untouched.
- After a full sales + collection + bill + payment cycle, **the trial balance
  balances.** That is the assertion that catches everything else.
