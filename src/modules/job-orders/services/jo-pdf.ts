import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { format } from "date-fns";
import { COMPANY } from "@/lib/company";
import type { JobOrderDetailDto } from "../schemas/job-order";

// JO/PO printable — shares the Ormoc Printshoppe form language with the
// Quotation printable (quotation-pdf.ts): logo + company block, title with
// DATE / DEADLINE boxes, CUSTOMER INFO bar beside a JOB DETAILS box, the
// DESCRIPTION OF WORK table (Line / Description / Qty / Unit Price / Amount),
// a TOTAL bar, and a Prepared-by signature beside a Customer Approval box.
// Until the customer approves (isApprovedByCustomer) it carries the
// "THIS IS FOR APPROVAL" banner; once approved it prints the approval stamp.

const PAGE_W = 595.28; // A4 portrait, points
const PAGE_H = 841.89;
const M = 44; // margin
const DARK = rgb(0.27, 0.27, 0.27); // #444 section bars
const RED = rgb(0.8, 0, 0); // legacy #CC0000 accents
const INK = rgb(0.08, 0.08, 0.08);
const GRAY = rgb(0.42, 0.42, 0.42);
const BORDER = rgb(0.62, 0.62, 0.62);
const LIGHT = rgb(0.82, 0.82, 0.82);

const CONTACT_LINE =
  "If you have any questions, please contact Michelle Ca-ang, 0963-1220016, ormocprintshoppe@gmail.com";
const COMPANY_EMAIL = "ormocprintshoppe@gmail.com";
const PREPARED_LABEL = "Prepared by"; // the JOB DETAILS box (who encoded the JO)
// Owner / proprietor shown in the "Reviewed and Approved by" block.
// TODO(settings): make the name + signature configurable in Company Profile
// settings — these are the current defaults.
const OWNER_NAME = "Joel O. Ngo";

// StandardFonts are WinAnsi — no ₱ glyph; "P" prefix is the PH convention.
const money = (value: string | number): string => {
  const n = typeof value === "number" ? value : parseFloat(value);
  return isNaN(n)
    ? String(value)
    : `P${n.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
};

const dateStr = (iso: string | null): string =>
  iso ? format(new Date(iso), "MMMM d, yyyy") : "—";
// Date-only fields (deadline, plan window) come as yyyy-MM-dd — anchor to local
// midnight so the printed day never shifts.
const dayStr = (d: string | null): string =>
  d ? format(new Date(`${d}T00:00:00`), "MMMM d, yyyy") : "—";
const titleCase = (s: string): string =>
  s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
// The seed/system account — never printed as "Prepared by".
const isSystemUser = (name: string): boolean =>
  !name || name.trim().toLowerCase() === "system admin";

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

// Proprietor's handwritten signature, stamped over the approval line. Read
// fresh each render (NOT cached) so a new upload in Settings prints right away.
async function loadSignature(): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(
      await readFile(path.join(process.cwd(), "public", "jon-signature.png"))
    );
  } catch {
    return null;
  }
}

export async function renderJoPdf(jo: JobOrderDetailDto): Promise<Uint8Array> {
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
    page.drawRectangle({ x, y: yy, width: w, height: h, borderColor, borderWidth: 0.8 });
  const hline = (yy: number, color = LIGHT, x1 = M, x2 = PAGE_W - M) =>
    page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness: 0.8, color });

  // ——— header: logo + company block (left), title + date boxes (right) ———
  const logoBytes = await loadLogo();
  if (logoBytes) {
    // The legacy asset is a JPEG mislabeled as PNG — sniff the magic bytes.
    const isPng = logoBytes[1] === 0x50 && logoBytes[2] === 0x4e;
    const logo = isPng ? await doc.embedPng(logoBytes) : await doc.embedJpg(logoBytes);
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

  const docType = jo.isPO ? "PURCHASE ORDER" : jo.isNonJo ? "NON-JO" : "JOB ORDER";
  rightText(docType, PAGE_W - M, y - 20, 24, bold);
  rightText(jo.joNumber, PAGE_W - M, y - 34, 11, bold, RED);

  // DATE / DEADLINE label-value boxes
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
  dateRow("DATE", dateStr(jo.createdAt));
  dateRow("DEADLINE", dayStr(jo.deadline));

  y -= 100;
  hline(y, DARK);
  y -= 14;

  // ——— approval stamp (only once the customer has approved) ———
  // The "THIS IS FOR APPROVAL" banner was removed — the Customer Approval box
  // at the bottom already carries that intent.
  if (jo.isApprovedByCustomer) {
    const stamp = `APPROVED BY CUSTOMER — ${dateStr(jo.customerApprovedAt)}`;
    text(stamp, M, y, 9, bold, rgb(0.05, 0.5, 0.3));
    y -= 20;
  }

  // ——— customer info (left) + job details box (right) ———
  const detW = 218;
  const detX = PAGE_W - M - detW;

  bar(M, y - 13, 150, 13);
  page.drawText("CUSTOMER INFO", {
    x: M + 8,
    y: y - 9.5,
    size: 7.5,
    font: bold,
    color: rgb(1, 1, 1),
  });
  let custY = y - 28;
  text(jo.customer.name, M, custY, 12, bold);
  custY -= 13;
  const custMeta = [
    jo.customer.company && jo.customer.company !== jo.customer.name ? jo.customer.company : null,
    jo.customer.contactNumber,
    jo.customer.email,
    jo.customer.address,
    jo.customer.tin ? `TIN: ${jo.customer.tin}` : null,
  ].filter((v): v is string => !!v);
  for (const meta of custMeta) {
    for (const line of wrap(meta, font, 8.5, detX - M - 14)) {
      text(line, M, custY, 8.5);
      custY -= 11;
    }
  }

  // JOB DETAILS box (mirrors the quotation's note box position).
  const detailRows: [string, string][] = [["Status", titleCase(jo.status)]];
  // Skip the system/seed account — don't print "Prepared by: System Admin".
  if (!isSystemUser(jo.createdByName)) {
    detailRows.push([PREPARED_LABEL, jo.createdByName]);
  }
  if (jo.planDateStart || jo.planDateEnd) {
    detailRows.push(["Plan window", `${dayStr(jo.planDateStart)} – ${dayStr(jo.planDateEnd)}`]);
  }
  if (jo.completedAt) detailRows.push(["Completed", dateStr(jo.completedAt)]);
  if (jo.isLFP) detailRows.push(["Type", "Large-Format Print"]);
  const detH = detailRows.length * 13 + 20;
  box(detX, y - detH, detW, detH);
  bar(detX, y - 13, detW, 13);
  page.drawText("JOB DETAILS", {
    x: detX + 8,
    y: y - 9.5,
    size: 7.5,
    font: bold,
    color: rgb(1, 1, 1),
  });
  let detY = y - 26;
  for (const [label, value] of detailRows) {
    text(label.toUpperCase(), detX + 8, detY, 6.5, font, GRAY);
    text(value, detX + 92, detY, 8, bold);
    detY -= 13;
  }

  y -= Math.max(detH, y - custY) + 18;

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
  if (jo.notes) {
    for (const line of wrap(jo.notes, font, 8, PAGE_W - M * 2)) {
      text(line, M, y, 8, font, rgb(0.25, 0.25, 0.25));
      y -= 10;
    }
    y -= 6;
  }

  // ——— items table ———
  const col = { no: M, desc: M + 34, qty: 356, unit: 404, amount: 486, end: PAGE_W - M };
  const headH = 16;
  bar(col.no, y - headH, col.end - col.no, headH);
  const th = (label: string, x: number) =>
    page.drawText(label, { x, y: y - 11.5, size: 7.5, font: bold, color: rgb(1, 1, 1) });
  th("Line", col.no + 4);
  th("DESCRIPTION", col.desc + 4);
  th("QTY", col.qty + 6);
  th("UNIT PRICE", col.unit + 6);
  th("AMOUNT", col.amount + 10);
  y -= headH;

  const drawCellBorders = (top: number, bottom: number) => {
    for (const x of [col.no, col.desc, col.qty, col.unit, col.amount, col.end]) {
      page.drawLine({ start: { x, y: top }, end: { x, y: bottom }, thickness: 0.8, color: LIGHT });
    }
    hline(bottom, LIGHT, col.no, col.end);
  };

  jo.items.forEach((item, index) => {
    // Vertical layout — one attribute per line — so the composed description
    // (service · size · qty · price breakdown, see job-description.ts) never
    // runs together. First part (service) is the bold title; the rest stack
    // beneath it. The extras line holds metadata it doesn't carry (line id,
    // category, status, due date).
    const parts = item.jobDescription.split(" · ");
    const service = parts[0] ?? "";
    const restParts = parts.slice(1);
    const extras: string[] = [];
    if (item.lineItemId) extras.push(item.lineItemId);
    if (item.category) extras.push(item.category);
    if (item.isRush) extras.push("RUSH");
    if (item.productionStatus) extras.push(item.productionStatus);
    if (item.deadline) extras.push(`Due ${dayStr(item.deadline)}`);

    const descW = col.qty - col.desc - 10;
    const titleLines = wrap(service, bold, 8.5, descW);
    const attrLines = restParts.flatMap((p) => wrap(p, font, 8, descW));
    const detailLines = extras.length ? wrap(extras.join("  ·  "), font, 7, descW) : [];
    const rowH = Math.max(
      titleLines.length * 10 + attrLines.length * 9.5 + detailLines.length * 8.5 + 12,
      24
    );
    const top = y;
    let ty = y - 12;
    for (const line of titleLines) {
      text(line, col.desc + 4, ty, 8.5, bold);
      ty -= 10;
    }
    for (const line of attrLines) {
      text(line, col.desc + 4, ty, 8, font, rgb(0.2, 0.2, 0.2));
      ty -= 9.5;
    }
    for (const line of detailLines) {
      text(line, col.desc + 4, ty, 7, font, rgb(0.42, 0.42, 0.42));
      ty -= 8.5;
    }
    text(String(index + 1), col.no + 10, top - 12, 8.5);
    text(String(item.qty), col.qty + 10, top - 12, 8.5);
    rightText(money(item.unitPrice), col.amount - 6, top - 12, 8.5);
    rightText(money(item.lineTotal), col.end - 6, top - 12, 8.5, bold);
    y = top - rowH;
    drawCellBorders(top, y);
  });

  // filler rows for the classic form look (min 2)
  for (let i = 0; i < Math.max(2, 4 - jo.items.length); i++) {
    const top = y;
    y -= 20;
    drawCellBorders(top, y);
  }

  // ——— total bar (right of the table) ———
  const tLabelX = col.qty;
  const totH = 17;
  y -= totH;
  bar(tLabelX, y, col.end - tLabelX, totH);
  page.drawText("TOTAL in PhP", { x: tLabelX + 6, y: y + 5, size: 8.5, font: bold, color: rgb(1, 1, 1) });
  rightText(money(jo.total), col.end - 6, y + 5, 9, bold, rgb(1, 1, 1));
  y -= 30;

  // ——— reviewed & approved by (left) + customer approval box (right) ———
  text("Reviewed and Approved by:", M, y, 8, italic, GRAY);
  const sigBytes = await loadSignature();
  if (sigBytes) {
    const isPng = sigBytes[1] === 0x50 && sigBytes[2] === 0x4e;
    const sig = isPng ? await doc.embedPng(sigBytes) : await doc.embedJpg(sigBytes);
    // Sit the signature ON the line (bottom near y-33), below the label —
    // not floating up over "Reviewed and Approved by:".
    const sigH = 26;
    const sigW = (sig.width / sig.height) * sigH;
    page.drawImage(sig, { x: M + (170 - sigW) / 2, y: y - 33, width: sigW, height: sigH });
  }
  page.drawLine({ start: { x: M, y: y - 34 }, end: { x: M + 170, y: y - 34 }, thickness: 0.8, color: INK });
  text(OWNER_NAME, M, y - 45, 10, bold);
  text("Proprietor", M, y - 56, 7.5, font, GRAY);

  const accW = 250;
  const accX = PAGE_W - M - accW;
  const accH = 90;
  box(accX, y - accH + 8, accW, accH);
  text("Customer Approval", accX + 10, y - 6, 9, bold);
  wrap(
    "I have reviewed the specifications, quantities, amounts, and promise date above and approve this job order.",
    italic,
    6.8,
    accW - 20
  )
    .slice(0, 3)
    .forEach((line, i) => {
      text(line, accX + 10, y - 19 - i * 8, 6.8, italic, rgb(0.3, 0.3, 0.3));
    });
  const sigY = y - accH + 26;
  const sigLine = (x: number, w: number, label: string) => {
    page.drawLine({ start: { x, y: sigY }, end: { x: x + w, y: sigY }, thickness: 0.8, color: INK });
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

function wrap(value: string, f: PDFFont, size: number, maxWidth: number): string[] {
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
