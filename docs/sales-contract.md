# Sales & Finance Contract

**Read this before writing code that touches money.**

OPS Fusion has two development tracks. Core dev owns Job Orders, Delivery
Receipts, Inventory/Purchasing, and the Customer master. The finance track owns
Quotations, Sales & Audit, Accounts Receivable, and everything downstream of a
peso changing hands.

Those tracks meet constantly. A Job Order's total becomes an invoice amount. A
Customer's credit terms become an invoice due date. A Delivery Receipt is gated
on an advance payment. When a change on the operations side gets the seam
wrong, the damage does not show up in the operations module — it shows up as a
wrong VAT report, a receivable that never closes, or revenue counted twice.

This file is the seam, written down. It is not style guidance. Every rule here
exists because breaking it produces a specific, known financial defect.

---

## Ownership map

| Path | Owner | Rule |
|---|---|---|
| `src/modules/quotations/**` | finance | core dev must not touch |
| `src/modules/sales-audit/**` | finance | core dev must not touch |
| `src/modules/customers/**` | core dev | **shared seam** — this contract applies |
| `src/modules/job-orders/**` | core dev | **shared seam** — this contract applies |
| `src/modules/delivery-receipts/**` | core dev | **shared seam** — this contract applies |
| `src/modules/inventory/**` | core dev | **shared seam** once Purchasing/AP lands |
| `prisma/schema/sale.prisma` | finance | core dev must not edit |
| `prisma/schema/collection-receipt.prisma` | finance | core dev must not edit |
| `prisma/schema/advance-payment.prisma` | finance | core dev must not edit |
| `prisma/schema/booklet.prisma`, `audit.prisma` | finance | core dev must not edit |
| `prisma/schema/customer.prisma`, `company.prisma` | shared | **credit fields are finance-owned** (see R8) |
| `src/lib/ability/policies/sales-audit.ts` | finance | core dev must not edit |

"Shared seam" means: you own the file, you may change it, **and** this contract
constrains what you may do to the financial fields inside it.

---

## The financial models, in one paragraph each

Read these before touching anything. Most defects come from assuming a model
means something it does not.

**`Sale`** — a receipt that BOOKS REVENUE. `SI_VAT`, `SI_NON_VAT`, `SI_CHARGE`
(sold on credit), `JO_SLIP` (the job-order downpayment slip). `amount` is gross
and VAT-inclusive; VAT is backed out of it, never added to it. This is the only
model that is revenue.

**`CollectionReceipt`** — cash arriving against a sale whose revenue was
ALREADY booked. It is deliberately not a `Sale`, because counting it as one
would double every peso in the VAT reports. Its `amount` is *tender taken in at
the counter*, not "what the customer paid down."

**`CrAllocation`** — which invoices a collection actually settled. This is what
closes a receivable. Its sum per sale is mirrored onto `Sale.settledAmount` in
the same transaction.

**`AdvancePayment`** — customer credit: money the shop holds FOR a customer,
the opposite sign to A/R. Created by an overpayment or taken as a plain
advance, drawn down by a later collection. Its `amount` is what came in;
`remaining` (`amount − sum(applications)`) is what is still available. Those are
different numbers and only one of them is usually the right one.

**`Booklet`** — BIR serial accountability. All 50 leaves of a booklet must be
traceable, which is why a spoiled receipt is voided in place and never deleted
or renumbered.

---

## Hard rules

Each rule states the defect it prevents. If a rule seems to be in your way, the
seam is probably being crossed in the wrong place — raise it, don't route
around it.

### R1 — Money is `Decimal` with an explicit scale. Quantity is `Int`.

Never `Float`, never `Number` for a stored amount, and never a bare `Decimal`
(Prisma's default is `(65,30)`, which is not a money type).

Scale depends on what the figure is:

- **A figure that lands on a document** — invoice amount, VAT, payment, credit
  limit, line total — is `@db.Decimal(12, 2)`. It is settled to the centavo.
- **A per-unit cost or rate** may carry more scale: `unitCost` in Inventory is
  `@db.Decimal(12, 4)` and should stay that way. A sheet of paper costs
  ₱0.3125; rounding that to ₱0.31 before multiplying by 5,000 loses ₱62.50.

In TypeScript, compute in **integer centavos** (`toCentavos` / `toAmount` in
`src/modules/sales-audit/services/money.ts`), never with floating-point
arithmetic on peso strings.

> *Prevents:* ₱0.01 drift that compounds across an aging report until the A/R
> total stops reconciling with the sum of its invoices.

### R2 — Never read a financial row without excluding voided and deleted.

```ts
// Sale, CollectionReceipt
where: { deletedAt: null, voidedAt: null }
// AdvancePayment
where: { deletedAt: null }
```

This applies to `_count` selects too — a `_count` with no filter counts voided
rows. Prisma requires the filter be repeated inside `_count`:

```ts
_count: { select: { sales: { where: { deletedAt: null, voidedAt: null } } } }
```

> *Prevents:* cancelled receipts presented as live revenue. A voided SI is not a
> sale; it is a spoiled piece of paper that keeps its serial number.

### R3 — Open balance is `amount − amountPaid − settledAmount`, floored at zero.

Never infer what is owed from `paymentStatus`. `amountPaid` is what the printed
invoice says was handed over at issue and is frozen; later collections land in
`settledAmount`. A `SI_CHARGE` fully settled by a collection next month still
carries `paymentStatus: UNPAID` — that is correct and intentional, because the
receipt is a legal record that must not be rewritten.

Use `openBalanceOf()` from the receivable service. Do not reimplement it.

**A report "as at" a past date is a reconstruction, not a filter.** All three
inputs above are *today's* values: `paymentStatus` reflects collections that
have since arrived, `voidedAt` reflects cancellations that have since happened,
and `settledAmount` is a running total with no date on it. Filtering today's
open invoices by `saleDate` therefore answers a much smaller question and
understates every historical figure. Pass `asOf` to
`listReceivables(customerId, asOf)`, which rewinds all three — and age from the
report date, never from `Date.now()`, or every historical debt lands in the
wrong bucket while the total still foots.

> *Prevents:* a paid-off customer showing as delinquent, and a delinquent one
> showing as settled — and a June aging report that quietly reports June's
> debt in today's buckets, minus everything collected since.

### R4 — Revenue is `Sale` and only `Sale`.

Never sum `CollectionReceipt` into a revenue, sales, or VAT figure.

> *Prevents:* every peso counted twice in the BIR VAT / Non-VAT reports.

### R5 — A collection's `amount` is not what the customer paid down.

The balancing identity is:

```
amount + creditApplied  =  sum(allocations) + creditCreated
```

Money paid by applying an existing credit is not cash crossing the counter
today. Money overpaid leaves as new credit. If you want "what this collection
settled," sum its `CrAllocation` rows. If you want "cash in the drawer today,"
use `amount`. They are rarely equal.

> *Prevents:* the day's collections total counting credit twice, and customer
> payment history overstating what they actually handed over.

### R6 — For customer credit, report `remaining`, not `amount`.

An `AdvancePayment` of ₱10,000 that has been fully applied is worth ₱0 to the
customer. Showing `amount` tells them they have ₱10,000 available.

> *Prevents:* the shop honouring credit it has already spent.

### R7 — Never aggregate money client-side over a paginated slice.

If a query has `take: N` and the UI then filters or sums the result, the total
is wrong and — worse — *silently* wrong. Date-range filters over a `take: 50`
window show whatever happened to fall inside the newest 50 rows.

Financial totals are computed in the repository, over the whole set, in SQL.
Filters that affect a total are pushed into the `where` clause.

> *Prevents:* a customer statement that quietly omits everything older than
> their 50 most recent documents.

### R8 — `creditTermDays` and `creditLimit` are admin-gated. Everywhere.

Any write to either field, on `Customer` **or** `Company`, requires:

```ts
assertCan(actor, "maintain", "Maintenance");
```

Terms and ceilings are reference data an admin sets, not something the cashier
taking the money decides at the counter. A path gated on `update Customer`
(which ENCODER holds) must not write these fields — it must silently omit them
from the update payload, the way
`PrismaCustomerDirectoryRepository.update` omits billing for company contacts.

> *Prevents:* the person about to issue a charge invoice raising the ceiling
> that was supposed to stop them.

### R9 — Every service method touching financial data calls `assertCan`.

Including reads. A signature of `(_actor: Actor, ...)` on a method that returns
credit limits, TINs, sales history, or profile attachments (Credit Request, BIR
2303) is a bug, not a shortcut.

> *Prevents:* a production role reading the customer's credit file.

### R10 — Issued documents are immutable snapshots.

`billedToName`, `billedToAddress`, `billedToTin`, `dueDate`, `vatableSales`,
`vatAmount` are captured AT ISSUE and never recomputed. Editing a Customer's
TIN, address, or credit terms must never reach back and rewrite a document that
was already printed.

If you are writing a migration or a backfill that touches these columns, stop
and raise it.

> *Prevents:* last year's filed invoice changing under a BIR audit.

### R11 — Voiding is not deleting.

A spoiled receipt keeps its row, its serial, and its booklet position. Mark
`voidType`, `voidReason`, `voidedAt`, `voidedById`. Never `deletedAt` a receipt
to make it go away, and never reissue its number.

The shop writes one word on the leaf — **CANCELLED** — in every case, so the
cashier is never asked to pick a mark and the UI never shows another one.
Cancelling is also the only action: reissuing a corrected receipt is cancel
(which reopens the balance) followed by an ordinary issue, exactly as it is on
paper. `CANCELLED` is the only value anything writes; `VOID` and `REPLACED`
appear on legacy rows only. Never branch a rule on the value — every financial
filter keys on `voidedAt` (**R2**).

> *Prevents:* a gap in booklet accountability, which is a BIR finding.

### R12 — One `ActivityLog` row per mutation, with a specific action.

Financial mutations get their own action name — `set-credit`, `void-receipt`,
`change-vat-status` — never a generic `update`. Changing a customer's VAT
status or TIN has downstream BIR consequences and must be reconstructable.

### R13 — Never truncate descriptions or specs. R14 — Soft deletes only.

House rules from `AGENTS.md`, restated because they bite hardest here: a
truncated line item on an invoice is a wrong invoice.

### R15 — A company credit ceiling is company-wide.

`Company.creditLimit` is pushed down onto every contact by
`syncBillingToContacts`. A/R aggregation that groups by `Customer` therefore
multiplies the ceiling by the number of contacts. Any exposure or limit check
for a company contact must aggregate across `companyId`, not `customerId`.

> *Prevents:* a company with a ₱100k limit and five contacts carrying ₱500k.

---

## Per-module contracts

### Customers & Companies

The customer master is where credit policy lives, so it is the highest-traffic
seam.

- Credit fields are finance-owned — **R8**. The edit form may display them
  read-only; it may not write them.
- Changing `vatStatus` or `tin` needs its own `ActivityLog` action — **R12** —
  and must not touch issued documents — **R10**.
- Deactivating (`status: INACTIVE`) or soft-deleting a customer with an open
  balance must be blocked or explicitly confirmed. A hidden customer with a
  receivable is a receivable nobody collects.
- Duplicate customers split A/R across two ledgers, so both look under-limit.
  If a merge path is ever built, it must move `Sale`, `CollectionReceipt`, and
  `AdvancePayment` rows and recompute exposure — finance must review it.
- Company contacts bill to the company but are invoiced individually. Any
  balance, statement, or limit shown for a contact must say which of the two it
  is measuring — **R15**.
- Any customer-facing financial figure should come from
  `ReceivableService`, not be recomputed locally. If you need a number it does
  not expose, ask for it to be added rather than summing rows in a component.

### Job Orders

- A JO's total feeds an invoice amount. Changing how the total is computed
  changes what gets billed — flag it.
- The downpayment is a `JO_SLIP` `Sale`, not a `CollectionReceipt`. It books
  revenue.
- One JO may carry a `JO_SLIP` and a later `SI` — the `jobOrderId` on `Sale` is
  deliberately **not** unique. Do not add a unique constraint.
- Cancelling or deleting a JO that already has an issued receipt must not
  remove or orphan that receipt — **R11**.
- `JobOrderItem.isLFP` feeds the PRISM LFP production module. Changing its
  meaning is a cross-track change.

### Delivery Receipts

- A DR is not a revenue event. Issuing one never creates a `Sale`.
- DR issuance is gated on advance payment / credit state. If you change that
  gate, you are changing when the shop is willing to release goods against
  credit — flag it.
- DR lines link to `JobOrderItem`. Billing reads through that link, so breaking
  it breaks what can be invoiced.

### Inventory → Purchasing → AP *(planned)*

Ahead of the MACWebApp fusion, so the seam is designed rather than discovered:

- A **Supplier is not a `Customer`.** Do not reuse the `Customer` model,
  its policies, or its attachment table for suppliers. Receivable and payable
  are opposite signs and sharing a model makes both reports wrong.
- The chain is PR → PO → Receiving → **supplier invoice → payable**. The
  supplier invoice is the finance seam: it references the PO and the receiving
  record, and may link to a JO.
- Payment posting and reconciliation are finance-side. Purchasing raises the
  obligation; it does not settle it.
- Costing feeds JO margin, which feeds pricing. Changing how material cost is
  captured changes reported profitability.

---

## Sales Impact Checklist

Work through this before calling a change done. It is short on purpose.

**Does this change touch any of the following?**

- [ ] A `Customer` or `Company` field — especially `creditTermDays`,
      `creditLimit`, `tin`, `vatStatus`, `address`, `status`
- [ ] A `Sale`, `CollectionReceipt`, `CrAllocation`, `AdvancePayment`,
      `Booklet`, or `AuditEntry` row — read **or** written
- [ ] A Job Order total, downpayment, or cancellation path
- [ ] A Delivery Receipt issuance gate
- [ ] Any column typed `Decimal`, or any figure rendered with a ₱

**If yes to any, confirm:**

- [ ] Every financial query filters `deletedAt` **and** `voidedAt` — including
      inside `_count` (**R2**)
- [ ] Balances use `amount − amountPaid − settledAmount`, not `paymentStatus`
      (**R3**)
- [ ] Any "as at <date>" report rewinds via `listReceivables(customerId, asOf)`
      and ages from that date, not from now (**R3**)
- [ ] No `CollectionReceipt` is summed into a revenue figure (**R4**)
- [ ] Customer credit is reported as `remaining`, not `amount` (**R6**)
- [ ] No money is summed client-side over a `take: N` slice (**R7**)
- [ ] No path writes `creditTermDays` / `creditLimit` without
      `assertCan(actor, "maintain", "Maintenance")` (**R8**)
- [ ] Every service method touching this data calls `assertCan` (**R9**)
- [ ] No issued-document snapshot column is recomputed (**R10**)
- [ ] Mutations log a specific `ActivityLog` action (**R12**)
- [ ] `npx tsx scripts/verify-sales-contract.ts` passes
- [ ] `npx tsc --noEmit` and ESLint are clean

**If the change alters a financial rule** — how a total is computed, when
credit is checked, what gates a DR — say so explicitly in the PR description
and tag the finance track. Do not decide it alone.

---

## Enforcement

Three layers, none of which replaces reading this file:

1. **`AGENTS.md`** points here, so the rule is present from the first turn of
   any session.
2. **A Claude Code hook** (`.claude/hooks/sales-contract-guard.mjs`) injects the
   relevant rules when a prompt or an edit touches a money-bearing path. It is
   advisory — it warns, it does not block.
3. **`scripts/verify-sales-contract.ts`** is the one that actually fails. Run it
   before you call anything done. Per `AGENTS.md`, a green verify script is the
   definition of done.

Layers 1 and 2 are reminders and can be missed. Layer 3 cannot.

### How the scanner behaves

```
npm run verify:sales-contract     # this contract only
npm run check                     # typecheck + lint + contract — run this before you push
```

It is a source scanner, so it needs no database and is safe in CI. It checks
R1, R2, R8, R9, R11 and R15 — the rules that can be verified mechanically. The
rest are on the checklist because they need judgement.

**It ratchets.** This contract was written against a codebase that predates it,
so there is real debt in modules the finance track does not own. Known
violations live in `scripts/sales-contract-baseline.json` as *counts* and are
reported without failing the run; anything beyond those counts fails
immediately. Debt can shrink, never grow — a tenth `_actor` cannot hide behind
nine grandfathered ones.

**Genuine exceptions opt out in place, with a reason:**

```ts
// contract:allow R2 — booklet accountability counts leaves, not revenue
prisma.sale.findFirst({ where: { bookletId: id }, select: { id: true } }),
```

A bare `contract:allow` with no reason does not satisfy the scanner. The point
of the hatch is that someone had to justify it — and those justifications are
now the best documentation of *why* the daily log shows voided receipts and the
A/R ledger does not.

**Never run `--update-baseline` to clear a fresh hit.** The baseline records
what predated the contract. Regenerate it only after actually fixing something.

### Current debt

At the time of writing: 12 `R9` violations (service methods taking `_actor` and
never checking it) across `job-orders` and `delivery-receipts`. Those are
core-dev files and are recorded rather than unilaterally edited — they are a
backlog item for that track, not a merge conflict waiting to happen.
