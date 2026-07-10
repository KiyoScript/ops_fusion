import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { format } from "date-fns";
import { COMPANY } from "@/lib/company";
import type { DrDetailDto } from "../schemas/delivery-receipt";

// Delivery Receipt printable — mirrors the physical Ormoc Printshoppe DR form:
// letterhead, DR meta block, customer block, QTY/DESCRIPTION/UNIT/AMOUNT table,
// total, Full/Partial delivery checkboxes, signature lines, and the BIR footer.

const PAGE_W = 595.28; // A4 portrait
const PAGE_H = 841.89;
const M = 44;
const INK = rgb(0.1, 0.1, 0.1);
const BRAND = rgb(0.72, 0.06, 0.13);
const GRAY = rgb(0.42, 0.42, 0.42);
const LINE = rgb(0.15, 0.15, 0.15);

const money = (v: string | number): string => {
  const n = typeof v === "number" ? v : parseFloat(v);
  return (isNaN(n) ? 0 : n).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

export async function renderDrPdf(dr: DrDetailDto): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([PAGE_W, PAGE_H]);

  const txt = (
    s: string,
    x: number,
    y: number,
    o: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb> } = {}
  ) => page.drawText(s, { x, y, size: o.size ?? 9, font: o.font ?? font, color: o.color ?? INK });
  const rightTxt = (s: string, xRight: number, y: number, o: { size?: number; font?: PDFFont } = {}) => {
    const f = o.font ?? font;
    const size = o.size ?? 9;
    page.drawText(s, { x: xRight - f.widthOfTextAtSize(s, size), y, size, font: f, color: INK });
  };
  const hline = (y: number, x1 = M, x2 = PAGE_W - M, color = LINE, thickness = 0.8) =>
    page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color });

  let y = PAGE_H - M;

  // ——— letterhead ———
  txt(COMPANY.name, M, y, { size: 17, font: bold, color: BRAND });
  txt("DELIVERY RECEIPT", PAGE_W - M - bold.widthOfTextAtSize("DELIVERY RECEIPT", 15), y, {
    size: 15,
    font: bold,
    color: BRAND,
  });
  y -= 13;
  txt(COMPANY.tagline, M, y, { size: 7.5, color: GRAY });
  const noLabel = `No. ${dr.drNumber}`;
  txt(noLabel, PAGE_W - M - bold.widthOfTextAtSize(noLabel, 12), y - 2, { size: 12, font: bold, color: BRAND });
  y -= 12;
  txt(COMPANY.address, M, y, { size: 7.5, color: GRAY });
  y -= 10;
  txt(COMPANY.tel, M, y, { size: 7.5, color: GRAY });
  y -= 10;
  txt(COMPANY.proprietor, M, y, { size: 7.5, color: GRAY });
  y -= 10;
  txt(COMPANY.vatTin, M, y, { size: 7.5, color: GRAY });
  y -= 12;
  hline(y);
  y -= 16;

  // ——— meta block (right) + customer block (left) ———
  const metaX = 360;
  const meta: [string, string][] = [
    ["No:", dr.drNumber],
    ["Date:", format(new Date(dr.issuedAt), "MM/dd/yyyy")],
    ["JO No:", dr.jobOrder.joNumber],
    ["Terms:", "Due on receipt"],
    ["Due date:", format(new Date(dr.issuedAt), "MM/dd/yyyy")],
  ];
  let metaY = y;
  for (const [k, v] of meta) {
    txt(k, metaX, metaY, { size: 8.5, font: bold, color: GRAY });
    txt(v, metaX + 52, metaY, { size: 8.5 });
    metaY -= 13;
  }

  const custBlock: [string, string][] = [
    ["Address:", dr.customer.address ?? "—"],
    ["Customer Name:", dr.customer.name],
    ["TIN:", dr.customer.tin ?? "—"],
    ["Business Style:", dr.customer.company ?? dr.customer.name],
  ];
  let custY = y;
  for (const [k, v] of custBlock) {
    txt(k, M, custY, { size: 8.5, font: bold, color: GRAY });
    for (const line of wrap(v, font, 9, metaX - M - 90)) {
      txt(line, M + 82, custY, { size: 9 });
      custY -= 12;
    }
  }
  y = Math.min(metaY, custY) - 8;
  hline(y);
  y -= 4;

  // ——— items table ———
  const col = { qty: M + 4, desc: M + 54, unit: 400, amount: 490 };
  txt("QTY", col.qty, y - 10, { size: 8, font: bold, color: GRAY });
  txt("DESCRIPTION", col.desc, y - 10, { size: 8, font: bold, color: GRAY });
  rightTxt("UNIT PRICE", col.unit + 48, y - 10, { size: 8, font: bold });
  rightTxt("AMOUNT", PAGE_W - M, y - 10, { size: 8, font: bold });
  y -= 16;
  hline(y);
  y -= 14;

  for (const line of dr.lines) {
    const descLines = wrap(line.description, font, 9, col.unit - col.desc - 10);
    const rowTop = y;
    txt(String(line.qty), col.qty, y, { size: 9 });
    for (const dl of descLines) {
      txt(dl, col.desc, y, { size: 9 });
      y -= 11;
    }
    rightTxt(money(line.unitPrice), col.unit + 48, rowTop, { size: 9 });
    rightTxt(money(line.lineTotal), PAGE_W - M, rowTop, { size: 9 });
    y -= 6;
  }

  y -= 10;
  rightTxt("Total Amount:", PAGE_W - M - 90, y, { size: 10, font: bold });
  rightTxt(money(dr.amount), PAGE_W - M, y, { size: 10, font: bold });
  y -= 30;

  if (dr.notes) {
    txt("Notes:", M, y, { size: 8, font: bold, color: GRAY });
    for (const line of wrap(dr.notes, font, 8.5, PAGE_W - 2 * M - 40)) {
      txt(line, M + 40, y, { size: 8.5, color: GRAY });
      y -= 11;
    }
    y -= 8;
  }

  // ——— delivery type checkboxes ———
  const checkbox = (x: number, cy: number, label: string) => {
    page.drawRectangle({ x, y: cy - 8, width: 11, height: 11, borderColor: LINE, borderWidth: 0.8 });
    txt(label, x + 16, cy - 6, { size: 9 });
  };
  const boxesY = Math.max(y, M + 150);
  checkbox(M, boxesY, "Full Delivery");
  checkbox(M + 150, boxesY, "Partial Delivery");
  rightTxt("TOTAL:", PAGE_W - M - 60, boxesY - 6, { size: 10, font: bold });

  // ——— signatures ———
  const sigY = M + 90;
  const sig = (x: number, w: number, label: string, sub?: string) => {
    hline(sigY, x, x + w);
    txt(label, x, sigY - 11, { size: 8, color: GRAY });
    if (sub) txt(sub, x, sigY - 21, { size: 7, color: GRAY });
  };
  sig(M, 150, "Approved by", "Proprietor / Manager");
  sig(M + 175, 150, "Prepared by", "Sales Representative");
  sig(M + 350, PAGE_W - M - (M + 350), "Received the above goods in good order", "Signature over Printed Name");

  // ——— BIR footer ———
  let fy = M + 34;
  txt(COMPANY.dr.disclaimer, M, fy, { size: 7, font: bold, color: GRAY });
  fy -= 10;
  txt(`${COMPANY.dr.atpNo} · ${COMPANY.dr.atpDate}`, M, fy, { size: 6.5, color: GRAY });
  fy -= 9;
  txt(`${COMPANY.dr.series}`, M, fy, { size: 6.5, color: GRAY });
  fy -= 9;
  txt(`${COMPANY.dr.accreditation} · ${COMPANY.dr.accreditationDate}`, M, fy, { size: 6.5, color: GRAY });

  if (dr.status === "CANCELLED") watermark(page, bold, "CANCELLED");

  return doc.save();
}

function watermark(page: PDFPage, font: PDFFont, text: string) {
  const size = 90;
  page.drawText(text, {
    x: 90,
    y: PAGE_H / 2,
    size,
    font,
    color: rgb(0.85, 0.2, 0.2),
    opacity: 0.18,
    rotate: { type: "degrees", angle: 32 } as never,
  });
}

function wrap(value: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const raw of value.split(/\r?\n/)) {
    let cur = "";
    for (const word of raw.split(/\s+/)) {
      const cand = cur ? `${cur} ${word}` : word;
      if (font.widthOfTextAtSize(cand, size) <= maxWidth) cur = cand;
      else {
        if (cur) out.push(cur);
        cur = word;
      }
    }
    out.push(cur);
  }
  return out.length ? out : [""];
}
