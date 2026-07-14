// Quotation money math — ONE implementation shared by the form (live
// preview) and the service (authoritative recompute on save; the legacy
// system trusted client-side totals, which this port deliberately does not).
// Pure module: safe to import from client components.

export const VAT_RATE = 0.12; // PH VAT (legacy quotation_system constant)

export type TaxType = "NON_VAT" | "VAT_EXCLUSIVE" | "VAT_INCLUSIVE";

export type TotalsInput = {
  items: { qty: number; unitPrice: number; discount: number }[];
  /** Header-level discount amount (on top of per-line discounts). */
  discount: number;
  taxType: TaxType;
  /** Downpayment fraction 0–1 (legacy payment terms). */
  downpaymentRate: number;
};

export type Totals = {
  lineTotals: number[];
  subtotal: number;
  discount: number;
  /** Net after all discounts — the tax base. */
  net: number;
  taxAmount: number;
  total: number;
  downpayment: number;
  balance: number;
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function computeTotals(input: TotalsInput): Totals {
  const lineTotals = input.items.map((item) =>
    round2(Math.max(item.qty * item.unitPrice - item.discount, 0))
  );
  const subtotal = round2(lineTotals.reduce((sum, n) => sum + n, 0));
  const discount = round2(Math.min(input.discount, subtotal));
  const net = round2(subtotal - discount);

  // Legacy VAT semantics: exclusive adds 12% on top; inclusive treats the
  // quoted amount as already containing VAT (tax shown for BIR breakdown).
  let taxAmount = 0;
  let total = net;
  if (input.taxType === "VAT_EXCLUSIVE") {
    taxAmount = round2(net * VAT_RATE);
    total = round2(net + taxAmount);
  } else if (input.taxType === "VAT_INCLUSIVE") {
    taxAmount = round2(net - net / (1 + VAT_RATE));
  }

  const downpayment = round2(total * input.downpaymentRate);
  return {
    lineTotals,
    subtotal,
    discount,
    net,
    taxAmount,
    total,
    downpayment,
    balance: round2(total - downpayment),
  };
}
