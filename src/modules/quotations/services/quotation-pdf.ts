import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { format } from "date-fns";
import { COMPANY } from "@/lib/company";
import type { QuotationDetailDto } from "../schemas/quotation";

// Quotation printable — faithful port of the legacy Quotation.html A4 form:
// logo + company block, QUOTATION title with DATE / VALID UNTIL boxes,
// CUSTOMER INFO bar beside the standard note box, DESCRIPTION OF WORK item
// table (Line No. / Description / Qty / Unit Price / Amount), totals with
// VAT + downpayment + balance, approver signature block, and the Customer
// Acceptance box. Unapproved quotes carry a DRAFT banner.

const PAGE_W = 595.28; // A4 portrait, points
const PAGE_H = 841.89;
const M = 44; // margin
const DARK = rgb(0.27, 0.27, 0.27); // #444 section bars
const RED = rgb(0.8, 0, 0); // legacy #CC0000 accents
const INK = rgb(0.08, 0.08, 0.08);
const GRAY = rgb(0.42, 0.42, 0.42);
const BORDER = rgb(0.62, 0.62, 0.62);
const LIGHT = rgb(0.82, 0.82, 0.82);

// Legacy footer/contact lines (Quotation.html).
const CONTACT_LINE =
  "If you have any questions, please contact Michelle Ca-ang, 0963-1220016, ormocprintshoppe@gmail.com";
const COMPANY_EMAIL = "ormocprintshoppe@gmail.com";
const PROPRIETOR_NAME = "Joel O. Ngo";

// StandardFonts are WinAnsi — no ₱ glyph; "P" prefix is the PH convention.
const money = (value: string | number): string => {
  const n = typeof value === "number" ? value : parseFloat(value);
  return isNaN(n)
    ? String(value)
    : `P${n.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
};

const NOT_FINAL = ["DRAFT", "PENDING_APPROVAL", "REJECTED"];

let logoCache: Uint8Array | null | undefined;
async function loadLogo(): Promise<Uint8Array | null> {
  if (logoCache !== undefined) return logoCache;
  try {
    logoCache = new Uint8Array(
      await readFile(path.join(process.cwd(), "public", "printshoppe-logo.png"))
    );
  } catch {
    logoCache = null;
  }
  return logoCache;
}

export async function renderQuotationPdf(
  quote: QuotationDetailDto
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);

  const page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - M;

  const text = (
    value: string,
    x: number,
    yy: number,
    size = 9,
    f: PDFFont = font,
    color = INK
  ) => page.drawText(value, { x, y: yy, size, font: f, color });
  const rightText = (
    value: string,
    rightX: number,
    yy: number,
    size = 9,
    f: PDFFont = font,
    color = INK
  ) =>
    page.drawText(value, {
      x: rightX - f.widthOfTextAtSize(value, size),
      y: yy,
      size,
      font: f,
      color,
    });
  const bar = (x: number, yy: number, w: number, h: number, color = DARK) =>
    page.drawRectangle({ x, y: yy, width: w, height: h, color });
  const box = (x: number, yy: number, w: number, h: number, borderColor = BORDER) =>
    page.drawRectangle({
      x,
      y: yy,
      width: w,
      height: h,
      borderColor,
      borderWidth: 0.8,
    });
  const hline = (yy: number, color = LIGHT, x1 = M, x2 = PAGE_W - M) =>
    page.drawLine({
      start: { x: x1, y: yy },
      end: { x: x2, y: yy },
      thickness: 0.8,
      color,
    });

  // ——— header: logo + company block (left), title + date boxes (right) ———
  const logoBytes = await loadLogo();
  if (logoBytes) {
    // The legacy asset is a JPEG mislabeled as PNG — sniff the magic bytes.
    const isPng = logoBytes[1] === 0x50 && logoBytes[2] === 0x4e;
    const logo = isPng
      ? await doc.embedPng(logoBytes)
      : await doc.embedJpg(logoBytes);
    const h = 52;
    const w = (logo.width / logo.height) * h;
    page.drawImage(logo, { x: M, y: y - h, width: w, height: h });
  } else {
    text(COMPANY.name, M, y - 16, 16, bold, RED);
  }
  let infoY = y - 64;
  text(`Address : ${COMPANY.address}`, M, infoY, 7.5, font, GRAY);
  infoY -= 10;
  text(`Tel : ${COMPANY.tel}`, M, infoY, 7.5, font, GRAY);
  infoY -= 10;
  text(`Email : ${COMPANY_EMAIL}`, M, infoY, 7.5, font, GRAY);

  rightText("QUOTATION", PAGE_W - M, y - 20, 26, bold);
  rightText(quote.quoteNumber, PAGE_W - M, y - 34, 11, bold, RED);

  // DATE / VALID UNTIL label-value boxes
  const boxRight = PAGE_W - M;
  const valueW = 108;
  const labelW = 74;
  const rowH = 15;
  let boxY = y - 58;
  const dateRow = (label: string, value: string) => {
    bar(boxRight - valueW - labelW, boxY, labelW, rowH);
    page.drawText(label, {
      x: boxRight - valueW - labelW + 8,
      y: boxY + 4,
      size: 7.5,
      font: bold,
      color: rgb(1, 1, 1),
    });
    box(boxRight - valueW, boxY, valueW, rowH);
    const v = font.widthOfTextAtSize(value, 8.5);
    page.drawText(value, {
      x: boxRight - valueW + (valueW - v) / 2,
      y: boxY + 4,
      size: 8.5,
      font,
      color: INK,
    });
    boxY -= rowH + 4;
  };
  dateRow("DATE", format(new Date(quote.createdAt), "MMMM d, yyyy"));
  dateRow(
    "VALID UNTIL",
    quote.validUntil
      ? format(new Date(`${quote.validUntil}T00:00:00`), "MMMM d, yyyy")
      : "30 days from date"
  );

  y -= 100;
  hline(y, DARK);
  y -= 14;

  // ——— DRAFT banner (unapproved statuses) ———
  if (NOT_FINAL.includes(quote.status)) {
    page.drawRectangle({
      x: M,
      y: y - 6,
      width: PAGE_W - M * 2,
      height: 18,
      color: rgb(1, 0.95, 0.78),
      borderColor: rgb(0.85, 0.65, 0.13),
      borderWidth: 0.8,
    });
    const banner = "DRAFT — PENDING SUPERVISOR APPROVAL";
    page.drawText(banner, {
      x: (PAGE_W - bold.widthOfTextAtSize(banner, 10)) / 2,
      y: y - 1,
      size: 10,
      font: bold,
      color: rgb(0.55, 0.4, 0),
    });
    y -= 26;
  }

  // ——— customer info (left) + note box (right) ———
  const noteW = 268;
  const noteX = PAGE_W - M - noteW;
  const custW = noteX - M - 14;

  bar(M, y - 13, 150, 13);
  page.drawText("CUSTOMER INFO", {
    x: M + 8,
    y: y - 9.5,
    size: 7.5,
    font: bold,
    color: rgb(1, 1, 1),
  });
  let custY = y - 28;
  text(quote.customer.name, M, custY, 12, bold);
  custY -= 13;
  if (quote.customer.contactNumber) {
    text(quote.customer.contactNumber, M, custY, 8.5);
    custY -= 11;
  }
  if (quote.customer.email) {
    text(quote.customer.email, M, custY, 8.5);
    custY -= 11;
  }
  if (quote.customer.address) {
    for (const line of wrap(quote.customer.address, font, 8.5, custW)) {
      text(line, M, custY, 8.5);
      custY -= 11;
    }
  }

  // Standard legalese note (legacy), with the quote's payment term folded in.
  const dpLine = quote.totals.paymentTermLabel
    ? `${quote.totals.paymentTermLabel} required to proceed with the orders.`
    : "Downpayment required to proceed with the orders.";
  const noteText =
    "Note : This quotation is not a contract or a bill. It is our best quote for the service and goods described above. The customer will be billed after indicating acceptance of this quote. Payment will be due prior to the delivery of service and goods based on agreed payment terms. Please submit or email this quote or PO should you proceed to ordering the items. " +
    dpLine;
  const noteLines = wrap(noteText, italic, 7.2, noteW - 16);
  const noteH = noteLines.length * 8.6 + 14;
  box(noteX, y - noteH, noteW, noteH);
  noteLines.forEach((line, i) => {
    text(line, noteX + 8, y - 15 - i * 8.6, 7.2, italic, rgb(0.25, 0.25, 0.25));
  });

  y -= Math.max(noteH, y - custY) + 18;

  // ——— DESCRIPTION OF WORK ———
  bar(M, y - 13, PAGE_W - M * 2, 13);
  page.drawText("DESCRIPTION OF WORK", {
    x: M + 8,
    y: y - 9.5,
    size: 7.5,
    font: bold,
    color: rgb(1, 1, 1),
  });
  y -= 26;
  const leadTime =
    quote.notes ||
    "Lead time: 5–10 working days after layout approval & downpayment.";
  for (const line of wrap(leadTime, font, 8, PAGE_W - M * 2)) {
    text(line, M, y, 8, font, rgb(0.25, 0.25, 0.25));
    y -= 10;
  }
  y -= 6;

  // ——— items table ———
  const col = { no: M, desc: M + 34, qty: 366, unit: 410, amount: 490, end: PAGE_W - M };
  const headH = 16;
  bar(col.no, y - headH, col.end - col.no, headH);
  const th = (label: string, x: number) =>
    page.drawText(label, {
      x,
      y: y - 11.5,
      size: 7.5,
      font: bold,
      color: rgb(1, 1, 1),
    });
  th("Line", col.no + 4);
  th("DESCRIPTION", col.desc + 4);
  th("QTY", col.qty + 8);
  th("UNIT PRICE", col.unit + 8);
  th("AMOUNT", col.amount + 12);
  y -= headH;

  const drawCellBorders = (top: number, bottom: number) => {
    for (const x of [col.no, col.desc, col.qty, col.unit, col.amount, col.end]) {
      page.drawLine({
        start: { x, y: top },
        end: { x, y: bottom },
        thickness: 0.8,
        color: LIGHT,
      });
    }
    hline(bottom, LIGHT, col.no, col.end);
  };

  quote.items.forEach((item, index) => {
    const parts = item.description.split(" · ");
    const titleLines = wrap(parts[0] ?? "", bold, 8.5, col.qty - col.desc - 10);
    const detailLines = parts
      .slice(1)
      .flatMap((p) => wrap(p, font, 7.5, col.qty - col.desc - 10));
    const rowH = Math.max(titleLines.length * 10 + detailLines.length * 9 + 12, 24);
    const top = y;
    let ty = y - 12;
    text(String(index + 1), col.no + 10, ty, 8.5);
    for (const line of titleLines) {
      text(line, col.desc + 4, ty, 8.5, bold);
      ty -= 10;
    }
    for (const line of detailLines) {
      text(line, col.desc + 4, ty, 7.5, font, rgb(0.25, 0.25, 0.25));
      ty -= 9;
    }
    text(String(item.qty), col.qty + 14, top - 12, 8.5);
    rightText(money(item.unitPrice), col.amount - 6, top - 12, 8.5);
    rightText(money(item.lineTotal), col.end - 6, top - 12, 8.5, bold);
    y = top - rowH;
    drawCellBorders(top, y);
  });

  // filler rows for the classic form look (min 2)
  for (let i = 0; i < Math.max(2, 4 - quote.items.length); i++) {
    const top = y;
    y -= 20;
    drawCellBorders(top, y);
  }

  // ——— totals block (right column of the table area) ———
  const totals = quote.totals;
  const tLabelX = col.qty;
  const tRow = (
    label: string,
    value: string,
    opts: { dark?: boolean; red?: boolean } = {}
  ) => {
    const h = opts.dark ? 17 : 14;
    const top = y;
    y -= h;
    if (opts.dark) bar(tLabelX, y, col.end - tLabelX, h);
    else box(tLabelX, y, col.end - tLabelX, h, LIGHT);
    const f = opts.dark ? bold : font;
    const color = opts.dark ? rgb(1, 1, 1) : opts.red ? RED : INK;
    page.drawText(label, {
      x: tLabelX + 6,
      y: y + (opts.dark ? 5 : 3.5),
      size: opts.dark ? 8.5 : 7.5,
      font: opts.dark ? bold : bold,
      color,
    });
    rightText(value, col.end - 6, y + (opts.dark ? 5 : 3.5), opts.dark ? 9 : 8, f, color);
    return top;
  };

  tRow("Others", "—");
  if (parseFloat(totals.discount) > 0) {
    tRow("Discount", `- ${money(totals.discount)}`);
  }
  if (totals.taxType === "VAT_EXCLUSIVE") {
    tRow("VAT (12%)", money(totals.taxAmount));
  } else if (totals.taxType === "VAT_INCLUSIVE") {
    tRow("VAT (12% included)", money(totals.taxAmount));
  }
  tRow("TOTAL QUOTE in PhP", money(totals.total), { dark: true });
  tRow(totals.paymentTermLabel ?? "Downpayment", money(totals.downpayment), {
    red: true,
  });
  tRow("Balance", money(totals.balance));
  y -= 26;

  // ——— approver (left) + customer acceptance box (right) ———
  const approver = quote.approvedByName ?? PROPRIETOR_NAME;
  text("Reviewed and Approved by:", M, y, 8, italic, GRAY);
  page.drawLine({
    start: { x: M, y: y - 34 },
    end: { x: M + 170, y: y - 34 },
    thickness: 0.8,
    color: INK,
  });
  text(approver, M, y - 45, 10, bold);
  text(quote.approvedByName ? "Approver" : "Proprietor", M, y - 56, 7.5, font, GRAY);

  const accW = 250;
  const accX = PAGE_W - M - accW;
  const accH = 78;
  box(accX, y - accH + 8, accW, accH);
  text("Customer Acceptance", accX + 10, y - 6, 9, bold);
  const sigY = y - accH + 26;
  const sigLine = (x: number, w: number, label: string) => {
    page.drawLine({
      start: { x, y: sigY },
      end: { x: x + w, y: sigY },
      thickness: 0.8,
      color: INK,
    });
    text(label, x, sigY - 9, 6.5, font, GRAY);
  };
  sigLine(accX + 10, 88, "Signature");
  sigLine(accX + 108, 82, "Printed Name");
  sigLine(accX + 200, 40, "Date");

  // ——— footer ———
  hline(M + 14, LIGHT);
  page.drawText(CONTACT_LINE, {
    x: (PAGE_W - font.widthOfTextAtSize(CONTACT_LINE, 7)) / 2,
    y: M,
    size: 7,
    font,
    color: rgb(0.35, 0.45, 0.6),
  });

  return doc.save();
}

function wrap(
  value: string,
  f: PDFFont,
  size: number,
  maxWidth: number
): string[] {
  const lines: string[] = [];
  for (const raw of value.split(/\r?\n/)) {
    let current = "";
    for (const word of raw.split(/\s+/)) {
      const candidate = current ? `${current} ${word}` : word;
      if (f.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        current = word;
      }
    }
    lines.push(current);
  }
  return lines.filter((l, i) => l !== "" || i === 0);
}
