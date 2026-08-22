import { ValidationError } from "@/lib/errors";
import {
  PaymentMethod,
  PaymentStatus,
  SaleType,
} from "@/generated/prisma/enums";

// ══════════════════════════════════════════════════════════════════════════
// Money & VAT — the arithmetic behind every receipt.
//
// All maths happens in INTEGER CENTAVOS. Money never touches a float: 0.1 +
// 0.2 !== 0.3 in IEEE-754, and a receipt that is one centavo out is a receipt
// the auditor has to chase.
// ══════════════════════════════════════════════════════════════════════════

/** BIR VAT rate — prices are quoted VAT-INCLUSIVE, so VAT is backed out. */
export const VAT_RATE = 0.12;
export const VAT_DIVISOR = 1.12;

/** "1,234.50" | 1234.5 → 123450 centavos. Rejects anything that isn't money. */
export function toCentavos(value: string | number): number {
  const raw = typeof value === "number" ? String(value) : value.trim().replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(raw)) {
    throw new ValidationError(`"${value}" is not a valid amount.`);
  }
  // Round rather than truncate: "0.005" is a half-centavo, not zero.
  return Math.round(parseFloat(raw) * 100);
}

/** 123450 → "1234.50" — the string form Prisma stores into Decimal(12,2). */
export function toAmount(centavos: number): string {
  const sign = centavos < 0 ? "-" : "";
  const abs = Math.abs(centavos);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export type VatSplit = {
  /** Gross, VAT-inclusive — what the customer actually pays. */
  amount: number;
  /** Net of VAT. */
  vatableSales: number;
  /** The 12% VAT component. Always 0 for Non-VAT and JO receipts. */
  vatAmount: number;
};

/**
 * Split a gross amount into net + VAT, exactly as the legacy SalesLogService
 * does: `vatable = total / 1.12`, `vat = vatable * 0.12`.
 *
 * One deliberate refinement: VAT is taken as the REMAINDER (gross − vatable)
 * rather than recomputed as `vatable * 0.12`. The two agree to the centavo in
 * exact arithmetic, but after rounding, the remainder is the only form that
 * guarantees `vatableSales + vatAmount === amount` — i.e. the printed receipt
 * always foots. Recomputing can leave it a centavo short.
 *
 * Non-VAT invoices and Job Order receipts carry no VAT: the whole amount is
 * "vatable sales" for reporting, with zero VAT.
 */
export function splitVat(grossCentavos: number, type: SaleType): VatSplit {
  if (grossCentavos < 0) {
    throw new ValidationError("Amount cannot be negative.");
  }
  // A Charge Invoice is a principal document and carries VAT exactly as a
  // cash Sales Invoice does — selling on credit does not change the tax, only
  // when the money arrives.
  if (type !== SaleType.SI_VAT && type !== SaleType.SI_CHARGE) {
    return { amount: grossCentavos, vatableSales: grossCentavos, vatAmount: 0 };
  }
  const vatableSales = Math.round(grossCentavos / VAT_DIVISOR);
  return {
    amount: grossCentavos,
    vatableSales,
    vatAmount: grossCentavos - vatableSales,
  };
}

// ——— tax withheld at source (BIR Forms 2307 and 2306) ———

/** Statutory VAT withholding by government / LGUs / GOCCs — RMC 36-2021. */
export const VAT_WITHHOLDING_RATE_PCT = "5";

/**
 * Tax a customer keeps back from what they owe us and remits to BIR for us.
 *
 * Serves BOTH withholdings, because they share a base and differ only in rate:
 *   • creditable INCOME tax — 1% goods / 2% services, BIR Form 2307
 *   • creditable VALUE-ADDED tax — 5% from government, BIR Form 2306
 *
 * THE BASE IS THE VAT-EXCLUSIVE AMOUNT — this is the whole reason the function
 * exists. On a ₱112,000 VAT invoice the base is ₱100,000, so 2% is ₱2,000 and
 * 5% is ₱5,000 — not the ₱2,240 and ₱5,600 you get from the gross. Computing
 * either on the gross over-withholds, the invoice never closes, and the shop
 * chases a customer for money they do not owe.
 *
 * `Sale.vatableSales` is that base for EVERY receipt type — splitVat puts the
 * whole amount there for Non-VAT and JO receipts — so it is the only figure
 * that should ever be passed in.
 *
 * @param vatableSalesCentavos the invoice's VAT-exclusive amount
 * @param ratePct              e.g. "2" or "5.00". Null → no withholding.
 * @param cap                  never suggest more than what is still open
 */
export function computeWithholding(
  vatableSalesCentavos: number,
  ratePct: string | number | null | undefined,
  cap?: number
): number {
  if (ratePct === null || ratePct === undefined || ratePct === "") return 0;
  const rate =
    typeof ratePct === "number" ? ratePct : parseFloat(String(ratePct));
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  if (rate > 100) {
    throw new ValidationError("Withholding rate cannot exceed 100%.");
  }
  if (vatableSalesCentavos <= 0) return 0;

  // Round, never truncate: a half-centavo of tax is a centavo, and truncating
  // leaves the invoice a centavo short of closing.
  const ewt = Math.round((vatableSalesCentavos * rate) / 100);
  return cap === undefined ? ewt : Math.min(ewt, Math.max(cap, 0));
}

// ——— tender: what the customer actually handed over ———

/** A tender line in centavos, as the service works with it. */
export type Tender = {
  method: PaymentMethod;
  amount: number;
  reference: string | null;
};

export type Settlement = {
  tenders: Tender[];
  /** Everything handed over, across all methods. */
  received: number;
  /** The part of it that settles this document — never more than the amount. */
  applied: number;
  /** Handed over above the amount due. Cash only. */
  changeGiven: number;
  /** Left unsettled: credit / utang / Accounts Receivable. */
  balanceDue: number;
  /** Physical cash handed over — what `Sale.cashTendered` records. */
  cashTendered: number | null;
};

/**
 * Work out one receipt's money from its tender lines.
 *
 * The lines ARE the money received — there is no separate "amount received"
 * to keep in step with them. From that one number both directions fall out:
 *
 *   received > due  → the excess is CHANGE (cash back at the counter)
 *   received < due  → the shortfall is a BALANCE: credit, utang, A/R, left
 *                     open until a Collection Receipt settles it
 *   no lines at all → nothing was received; the whole amount is A/R, which is
 *                     exactly what a Charge Invoice is (docs/sales.txt §3.1.3)
 *
 * Duplicate methods are kept as SEPARATE lines on purpose — two cheques are
 * two cheque numbers, and collapsing them would lose a reference the auditor
 * needs.
 */
export function settleTenders(
  lines: { method: PaymentMethod; amount: string; reference?: string }[],
  dueCentavos: number
): Settlement {
  const tenders: Tender[] = lines.map((l, i) => {
    const amount = toCentavos(l.amount);
    if (amount <= 0) {
      throw new ValidationError(
        `Payment line ${i + 1} must be greater than zero.`
      );
    }
    return { method: l.method, amount, reference: l.reference?.trim() || null };
  });

  const received = tenders.reduce((t, l) => t + l.amount, 0);
  const cash = tenders
    .filter((l) => l.method === PaymentMethod.CASH)
    .reduce((t, l) => t + l.amount, 0);

  const changeGiven = Math.max(received - dueCentavos, 0);
  // Only cash comes back over the counter. Nobody hands ₱156 back out of a
  // GCash transfer — an over-sent transfer is a refund, not change, and that
  // is a different document.
  if (changeGiven > cash) {
    throw new ValidationError(
      `Only cash can be over-tendered. ${toAmount(changeGiven)} is above the ` +
        `amount due but only ${toAmount(cash)} was paid in cash.`
    );
  }

  const applied = Math.min(received, dueCentavos);
  return {
    tenders,
    received,
    applied,
    changeGiven,
    balanceDue: dueCentavos - applied,
    cashTendered: cash > 0 ? cash : null,
  };
}

// ——— a job order's money position ———
//
// These two are the ONLY definitions of "what is this job worth" and "how much
// has come in against it". They live here, next to the rest of the centavo
// arithmetic, because two callers need them and used to answer them
// differently: the Receive Payment dialog counted legacy collections and fell
// back to line items, and the Job Order board did neither — so a job could
// read Paid in the dialog and Unpaid on the board behind it.

/**
 * A job order's own total, in centavos.
 *
 * Falls back to the sum of its line items when the header total is zero.
 * Legacy JOs imported from the sheet carry no header total, and treating one
 * as a ₱0 job makes every payment figure derived from it meaningless — a job
 * cannot be "fully paid" against a total of nothing, so it reads as Partial
 * forever no matter how much money came in.
 */
export function joTotalCentavos(jo: {
  total: { toString(): string };
  items: { lineTotal: { toString(): string } }[];
}): number {
  const header = toCentavos(jo.total.toString());
  if (header > 0) return header;
  return jo.items.reduce((t, i) => t + toCentavos(i.lineTotal.toString()), 0);
}

/**
 * Money actually received against a job order, in centavos.
 *
 * Read off the INVOICES (`amountPaid` at issue + `settledAmount` collected
 * since) rather than off the job's own collection receipts, because a
 * customer-level payment settles invoices across several jobs at once and is
 * attached to none of them. Summing the job's own CRs would miss that money
 * entirely — and double-count it whenever a CR happened to be job-scoped.
 *
 * The exception is a legacy collection: one written before allocations
 * existed has no `settledAmount` anywhere to be found in, so it is counted
 * from its own face. An empty allocation list is exactly what identifies one.
 *
 * Cancelled receipts contribute nothing — pass live rows only (R2).
 */
export function joCollectedCentavos(input: {
  sales: {
    amountPaid: { toString(): string };
    settledAmount: { toString(): string };
  }[];
  crs: { amount: { toString(): string }; allocations: unknown[] }[];
}): number {
  const fromInvoices = input.sales.reduce(
    (t, s) =>
      t +
      toCentavos(s.amountPaid.toString()) +
      toCentavos(s.settledAmount.toString()),
    0
  );
  const fromLegacyCrs = input.crs
    .filter((c) => c.allocations.length === 0)
    .reduce((t, c) => t + toCentavos(c.amount.toString()), 0);
  return fromInvoices + fromLegacyCrs;
}

/**
 * Still owed on ONE invoice, in centavos, never below zero.
 *
 * R3 — this is the only way to ask what is owed, and the reason it cannot be
 * read off `paymentStatus` is that `paymentStatus` records the position AT
 * ISSUE and is deliberately frozen: a charge invoice settled by a collection
 * next month still carries UNPAID, because the receipt is a legal record that
 * must not be rewritten. `amountPaid` is what the printed invoice says was
 * handed over at the counter; `settledAmount` is everything collected since.
 *
 * Note what this is NOT: a job order's total less what it has received. Work
 * that has never been invoiced is not owed by anybody, so a receivable is only
 * ever the sum of this across a job's live invoices.
 */
export function openBalanceOf(invoice: {
  amount: { toString(): string };
  amountPaid: { toString(): string };
  settledAmount: { toString(): string };
}): number {
  return Math.max(
    toCentavos(invoice.amount.toString()) -
      toCentavos(invoice.amountPaid.toString()) -
      toCentavos(invoice.settledAmount.toString()),
    0
  );
}

/** PAID / PARTIAL / UNPAID, derived — never set by hand. */
export function paymentStatusOf(
  applied: number,
  dueCentavos: number
): PaymentStatus {
  if (applied <= 0) return PaymentStatus.UNPAID;
  return applied >= dueCentavos ? PaymentStatus.PAID : PaymentStatus.PARTIAL;
}

/**
 * The header summary of a split: its LARGEST line. The day log, BIR reports
 * and printables read `paymentMethod` / `methodDetail` off the header, so the
 * dominant tender is what they show — `payments` carries the full breakdown.
 * Ties go to the earlier line, keeping the counter's entry order meaningful.
 */
export function dominantTender(tenders: Tender[]): Tender {
  return tenders.reduce((best, l) => (l.amount > best.amount ? l : best));
}
