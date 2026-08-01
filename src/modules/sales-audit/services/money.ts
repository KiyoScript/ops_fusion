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
