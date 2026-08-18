import type { QuotationDetailDto } from "../schemas/quotation";
import { buildQuoteBodyLines } from "./quote-messenger";

// Dynamic email subject + body for a quotation — reuses the shared itemized
// body (buildQuoteBodyLines) so the messenger copy and the email stay in sync.
// Generalizes across every service category (subject names the first item).

export function buildQuoteEmail(quote: QuotationDetailDto): {
  subject: string;
  body: string;
} {
  const firstItem = quote.items[0]?.description.split(" · ")[0]?.trim();
  const subject = firstItem
    ? `Quotation ${quote.quoteNumber} – ${firstItem} | Ormoc Printshoppe`
    : `Quotation ${quote.quoteNumber} | Ormoc Printshoppe`;

  const name = quote.customer.name?.trim() || "Valued Customer";
  const body = [
    `Dear ${name},`,
    "",
    "Thank you for your inquiry. Please see our quotation below:",
    "",
    ...buildQuoteBodyLines(quote),
    "",
    "Please also see the attached PDF quotation for your reference.",
    "Once confirmed, we can proceed with the layout and production.",
    "",
    "Thank you for choosing Ormoc Printshoppe!",
    "",
    "Best regards,",
    "Ormoc Printshoppe",
  ].join("\n");

  return { subject, body };
}
