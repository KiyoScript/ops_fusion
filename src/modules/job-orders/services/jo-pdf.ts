import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { format } from "date-fns";
import type { JobOrderDetailDto } from "../schemas/job-order";

// JO/PO printable. Until the customer approves (isApprovedByCustomer), the
// document carries the "THIS IS FOR APPROVAL" banner + a signature line —
// once approved it prints as a working copy with the approval stamp.
// (Dot-matrix/continuous-form output is a separate spike; this is the
// standard PDF printable.)

const PAGE_W = 595.28; // A4 portrait, points
const PAGE_H = 841.89;
const MARGIN = 48;
const BRAND = rgb(0.72, 0.06, 0.13); // brand crimson
const GRAY = rgb(0.45, 0.45, 0.45);
const LIGHT = rgb(0.92, 0.9, 0.87);

// StandardFonts are WinAnsi — no ₱ glyph, so amounts print as "PHP".
const money = (value: string): string => {
  const n = parseFloat(value);
  return isNaN(n)
    ? value
    : `PHP ${n.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
};

const dateStr = (iso: string | null): string =>
  iso ? format(new Date(iso), "MMMM d, yyyy") : "—";

export async function renderJoPdf(jo: JobOrderDetailDto): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const newPage = () => {
    page = doc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
  };
  const ensure = (needed: number) => {
    if (y - needed < MARGIN + 60) newPage();
  };
  const text = (
    value: string,
    opts: { x?: number; size?: number; font?: PDFFont; color?: ReturnType<typeof rgb> } = {}
  ) => {
    page.drawText(value, {
      x: opts.x ?? MARGIN,
      y,
      size: opts.size ?? 10,
      font: opts.font ?? font,
      color: opts.color ?? rgb(0.1, 0.1, 0.1),
    });
  };
  const line = (yy: number, color = LIGHT) =>
    page.drawLine({
      start: { x: MARGIN, y: yy },
      end: { x: PAGE_W - MARGIN, y: yy },
      thickness: 1,
      color,
    });

  // ——— header ———
  text("ORMOC PRINTSHOPPE", { size: 16, font: bold, color: BRAND });
  y -= 14;
  text("OPS Fusion — Fully Unified System Integrating Operations & Inventory", {
    size: 8,
    color: GRAY,
  });
  const docType = jo.isPO ? "PURCHASE ORDER" : jo.isNonJo ? "NON-JO" : "JOB ORDER";
  page.drawText(docType, {
    x: PAGE_W - MARGIN - bold.widthOfTextAtSize(docType, 14),
    y: PAGE_H - MARGIN,
    size: 14,
    font: bold,
    color: BRAND,
  });
  const numText = jo.joNumber;
  page.drawText(numText, {
    x: PAGE_W - MARGIN - bold.widthOfTextAtSize(numText, 11),
    y: PAGE_H - MARGIN - 16,
    size: 11,
    font: bold,
  });
  y -= 18;
  line(y);
  y -= 20;

  // ——— approval banner ———
  if (!jo.isApprovedByCustomer) {
    page.drawRectangle({
      x: MARGIN,
      y: y - 8,
      width: PAGE_W - MARGIN * 2,
      height: 24,
      color: rgb(1, 0.95, 0.78),
      borderColor: rgb(0.85, 0.65, 0.13),
      borderWidth: 1,
    });
    const banner = "THIS IS FOR APPROVAL";
    page.drawText(banner, {
      x: (PAGE_W - bold.widthOfTextAtSize(banner, 12)) / 2,
      y: y - 1,
      size: 12,
      font: bold,
      color: rgb(0.55, 0.4, 0),
    });
    y -= 36;
  } else {
    const stamp = `APPROVED BY CUSTOMER — ${dateStr(jo.customerApprovedAt)}`;
    page.drawText(stamp, {
      x: MARGIN,
      y,
      size: 10,
      font: bold,
      color: rgb(0.05, 0.5, 0.3),
    });
    y -= 22;
  }

  // ——— JO info ———
  const info: [string, string][] = [
    ["Customer", jo.customer.name],
    ["Date created", dateStr(jo.createdAt)],
    ["Deadline", dateStr(jo.deadline)],
    ["Prepared by", jo.createdByName],
  ];
  if (jo.planDateStart || jo.planDateEnd) {
    info.push([
      "Plan window",
      `${dateStr(jo.planDateStart)} – ${dateStr(jo.planDateEnd)}`,
    ]);
  }
  for (const [label, value] of info) {
    text(label.toUpperCase(), { size: 7, color: GRAY });
    text(value, { x: MARGIN + 110, size: 10 });
    y -= 15;
  }
  if (jo.notes) {
    text("NOTES", { size: 7, color: GRAY });
    text(jo.notes.replace(/\s+/g, " ").slice(0, 110), { x: MARGIN + 110, size: 9 });
    y -= 15;
  }
  y -= 6;

  // ——— items table ———
  const cols = { n: MARGIN, desc: MARGIN + 24, qty: 400, amount: 470 };
  line(y + 10, GRAY);
  y -= 4;
  text("#", { x: cols.n, size: 8, font: bold, color: GRAY });
  text("DESCRIPTION", { x: cols.desc, size: 8, font: bold, color: GRAY });
  text("QTY", { x: cols.qty, size: 8, font: bold, color: GRAY });
  text("AMOUNT", { x: cols.amount, size: 8, font: bold, color: GRAY });
  y -= 6;
  line(y, GRAY);
  y -= 14;

  jo.items.forEach((item, index) => {
    const descLines = wrap(item.description, font, 9, cols.qty - cols.desc - 12);
    const extras: string[] = [];
    if (item.category) extras.push(item.category);
    if (item.isLFP && item.lfpWidth && item.lfpHeight) {
      extras.push(`LFP ${item.lfpWidth} x ${item.lfpHeight} ${item.lfpUnit ?? ""}`);
    }
    if (item.isRush) extras.push("RUSH");
    if (item.deadline) extras.push(`Due ${dateStr(item.deadline)}`);
    const blockHeight = descLines.length * 11 + (extras.length ? 11 : 0) + 8;
    ensure(blockHeight);

    text(String(index + 1), { x: cols.n, size: 9 });
    for (const dl of descLines) {
      text(dl, { x: cols.desc, size: 9 });
      y -= 11;
    }
    if (extras.length) {
      text(extras.join("  ·  "), { x: cols.desc, size: 7, color: GRAY });
      y -= 11;
    }
    const rowTop = y + descLines.length * 11 + (extras.length ? 11 : 0);
    page.drawText(String(item.qty), { x: cols.qty, y: rowTop - 11, size: 9, font });
    page.drawText(money(item.lineTotal), { x: cols.amount, y: rowTop - 11, size: 9, font });
    y -= 8;
  });

  line(y + 4, GRAY);
  y -= 12;
  ensure(30);
  text("TOTAL", { x: cols.qty, size: 10, font: bold });
  text(money(jo.total), { x: cols.amount, size: 10, font: bold });
  y -= 30;

  // ——— signature block (unapproved printables) ———
  if (!jo.isApprovedByCustomer) {
    ensure(70);
    text(
      "I have reviewed the specifications, quantities, amounts, and promise date above and approve this job order.",
      { size: 8, color: GRAY }
    );
    y -= 40;
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: MARGIN + 220, y },
      thickness: 1,
      color: rgb(0.1, 0.1, 0.1),
    });
    y -= 11;
    text("Customer signature over printed name / date", { size: 7, color: GRAY });
    y -= 20;
  }

  // ——— footer ———
  page.drawText(
    `Generated ${format(new Date(), "M/d/yyyy h:mm a")} · OPS Fusion`,
    { x: MARGIN, y: MARGIN - 18, size: 7, font, color: GRAY }
  );

  return doc.save();
}

function wrap(value: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const raw of value.split(/\r?\n/)) {
    let current = "";
    for (const word of raw.split(/\s+/)) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        current = word;
      }
    }
    lines.push(current);
  }
  return lines.length ? lines : [""];
}
