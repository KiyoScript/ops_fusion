import type { QuotationDetailDto } from "../schemas/quotation";

// Ready-to-copy, messenger/Viber/SMS-friendly quote text (EOD format). Pure —
// reads only the serialized quote DTO, so it is reused by the "Copy quote"
// button AND the email body. Generalizes across every service category: each
// line item's composed description (product · spec · fees…) becomes the item
// header + bullets, with the line amount and grand total from the quote totals.

const peso = (v: string | number): string => {
  const n = typeof v === "number" ? v : parseFloat(v);
  return `₱${(Number.isFinite(n) ? n : 0).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const vatLabel = (taxType: string): string =>
  taxType === "VAT_EXCLUSIVE"
    ? "VAT Exclusive (+12%)"
    : taxType === "VAT_INCLUSIVE"
      ? "VAT Inclusive"
      : "Non-VAT";

/** The itemized body shared by the messenger copy and the email body. */
export function buildQuoteBodyLines(quote: QuotationDetailDto): string[] {
  const lines: string[] = [];
  for (const item of quote.items) {
    const parts = item.description
      .split(" · ")
      .map((p) => p.trim())
      .filter(Boolean);
    lines.push((parts[0] ?? "Item").toUpperCase());
    for (const p of parts.slice(1)) lines.push(`• ${p}`);

    const qty = Number(item.qty) || 1;
    lines.push(
      qty > 1
        ? `• ${qty} × ${peso(item.unitPrice)} = ${peso(item.lineTotal)}`
        : `• Amount: ${peso(item.lineTotal)}`
    );
    if (parseFloat(item.discount) > 0) lines.push(`• Less: ${peso(item.discount)}`);
    lines.push("");
  }

  lines.push(`TOTAL: ${peso(quote.totals.total)}`);
  lines.push(vatLabel(quote.totals.taxType));
  if (
    quote.totals.paymentTermLabel &&
    parseFloat(quote.totals.downpayment) > 0
  ) {
    lines.push(`${quote.totals.paymentTermLabel}: ${peso(quote.totals.downpayment)}`);
  }
  return lines;
}

/** Full messenger/Viber/SMS text with greeting + closing. */
export function buildMessengerQuote(quote: QuotationDetailDto): string {
  const name = quote.customer.name?.trim() || "there";
  return [
    `Hi ${name}! 😊 Here's your quick quote:`,
    "",
    ...buildQuoteBodyLines(quote),
    "",
    "Once confirmed, we can proceed with the layout and production. Thank you for choosing Ormoc Printshoppe! 😊",
  ].join("\n");
}
