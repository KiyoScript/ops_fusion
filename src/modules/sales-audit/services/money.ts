import { ValidationError } from "@/lib/errors";
import { SaleType } from "@/generated/prisma/enums";

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
  if (type !== SaleType.SI_VAT) {
    return { amount: grossCentavos, vatableSales: grossCentavos, vatAmount: 0 };
  }
  const vatableSales = Math.round(grossCentavos / VAT_DIVISOR);
  return {
    amount: grossCentavos,
    vatableSales,
    vatAmount: grossCentavos - vatableSales,
  };
}

/**
 * Cash handed over vs. amount due. `null` tendered (a cheque, a bank transfer)
 * means no change is given.
 */
export function computeChange(
  tenderedCentavos: number | null,
  dueCentavos: number
): number {
  if (tenderedCentavos === null) return 0;
  if (tenderedCentavos < dueCentavos) {
    throw new ValidationError(
      `Cash received (${toAmount(tenderedCentavos)}) is less than the amount due (${toAmount(dueCentavos)}).`
    );
  }
  return tenderedCentavos - dueCentavos;
}
