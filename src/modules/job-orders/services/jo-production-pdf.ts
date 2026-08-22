import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { format } from "date-fns";
import { COMPANY } from "@/lib/company";
import type { JobOrderDetailDto, JobOrderItemDto } from "../schemas/job-order";

// Job Order print for a 2-PLY CONTINUOUS FORM, HALF-LETTER LANDSCAPE (8.5" × 5.5")
// — a plain monospace (Courier) layout like the shop's dot-matrix forms, NOT the
// old branded A4 design. Multi-item jobs overflow with CARRIED FORWARD /
// BROUGHT FORWARD running subtotals so each page fits the form. The financial
// footer (VATable / VAT / TOTAL / DOWNPAYMENT) comes from the source quotation's
// tax type when the JO was converted from one.

const PAGE_W = 612; // 8.5in
const PAGE_H = 396; // 5.5in
const M = 24;
const INK = rgb(0.1, 0.1, 0.1);
const GRAY = rgb(0.4, 0.4, 0.4);
const S = 8; // body font size
const LH = 10.5; // line height

// Right edges of the numeric columns; DESCRIPTION flows between noX and qtyR.
const noX = M;
const descX = M + 14;
const qtyR = 402;
const sqftR = 452;
const rateR = 508;
const amtR = PAGE_W - M;

export type JoPrintFinancials = {
  taxType: "NON_VAT" | "VAT_EXCLUSIVE" | "VAT_INCLUSIVE";
  downpaymentRate: number;
  paymentTermLabel: string | null;
} | null;

const money = (n: number): string =>
  n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const round2 = (n: number) => Math.round(n * 100) / 100;
const trimNum = (n: number): string => (Number.isInteger(n) ? String(n) : String(round2(n)));
const dateStr = (iso: string | null): string => (iso ? format(new Date(iso), "dd MMM yyyy") : "—");
const dayStr = (d: string | null): string =>
  d ? format(new Date(`${d}T00:00:00`), "dd MMM yyyy") : "—";
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

// Word-wrap to a pixel width (monospace) so descriptions/specs are NEVER
// truncated — a house rule. A single word wider than the column is hard-broken.
function wrapToWidth(text: string, maxW: number, f: PDFFont, size: number): string[] {
  const fits = (s: string) => f.widthOfTextAtSize(s, size) <= maxW;
  const lines: string[] = [];
  let cur = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const trial = cur ? `${cur} ${word}` : word;
    if (fits(trial)) {
      cur = trial;
      continue;
    }
    if (cur) lines.push(cur);
    if (fits(word)) {
      cur = word;
    } else {
      let chunk = "";
      for (const ch of word) {
        if (fits(chunk + ch)) chunk += ch;
        else {
          if (chunk) lines.push(chunk);
          chunk = ch;
        }
      }
      cur = chunk;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

type PrintRow = {
  no: number;
  desc: string;
  qty: number;
  sqft: string;
  rate: string;
  amount: number; // base amount
  specLine: string;
  chargeLine: string | null;
  chargeAmt: number | null;
};

// Turn a JO item into the printable rows. Tarpaulin items expose per-piece SQ FT
// and a per-sqft RATE with add-on charges broken out; everything else prints the
// composed description with the line total.
function decodeItem(item: JobOrderItemDto, index: number): PrintRow {
  const specs =
    item.specs && typeof item.specs === "object" && !Array.isArray(item.specs)
      ? (item.specs as Record<string, unknown>)
      : null;
  const lineTotal = parseFloat(item.lineTotal) || 0;
  const desc =
    (item.description && item.description.trim()) ||
    item.service ||
    (item.jobDescription.split(" · ")[0] ?? "Item");

  if (specs && specs.calculator === "tarpaulin") {
    const w = num(specs.width);
    const h = num(specs.height);
    const unit = typeof specs.unit === "string" ? specs.unit : "";
    const sqftPerPc = num(specs.sqftPerPc);
    const rate = num(specs.ratePerSqft);
    const eyelet = typeof specs.eyelet === "string" ? specs.eyelet : "";
    const base =
      sqftPerPc != null && rate != null
        ? round2(item.qty * sqftPerPc * rate)
        : lineTotal;
    const chargeAmt = round2(lineTotal - base);
    const chargeParts: string[] = [];
    if (specs.rush) chargeParts.push(`Rush ${money(num(specs.rushFee) ?? 0)}`);
    if (specs.design) chargeParts.push(`Design ${money(num(specs.designFee) ?? 0)}`);
    const bits = [
      w != null && h != null ? `${trimNum(w)} x ${trimNum(h)}${unit ? " " + unit : ""}` : null,
      eyelet && eyelet.toLowerCase() !== "no eyelet" ? eyelet.toLowerCase() : null,
    ].filter((b): b is string => !!b);
    return {
      no: index + 1,
      desc,
      qty: item.qty,
      sqft: sqftPerPc != null ? trimNum(sqftPerPc) : "",
      rate: rate != null ? rate.toFixed(2) : "",
      amount: base,
      specLine: bits.join(" | "),
      chargeLine:
        chargeParts.length > 0 ? chargeParts.join(" | ") : chargeAmt > 0.005 ? "Add-ons" : "",
      chargeAmt: chargeAmt > 0.005 ? chargeAmt : null,
    };
  }

  // Generic / other calculators: composed spec text as the sub-line.
  const rest = item.jobDescription
    .split(" · ")
    .slice(1)
    .filter((p) => !/=|×/.test(p)) // drop the "price × qty = total" tail
    .join(" | ");
  return {
    no: index + 1,
    desc,
    qty: item.qty,
    sqft: "",
    rate: "",
    amount: lineTotal,
    specLine: rest,
    chargeLine: null,
    chargeAmt: null,
  };
}

export async function renderJoProductionPdf(
  jo: JobOrderDetailDto,
  fin?: JoPrintFinancials
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Courier);
  const bold = await doc.embedFont(StandardFonts.CourierBold);

  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;

  const t = (s: string, x: number, yy: number, size = S, f: PDFFont = font, color = INK) =>
    page.drawText(s, { x, y: yy, size, font: f, color });
  const tr = (s: string, xr: number, yy: number, size = S, f: PDFFont = font, color = INK) =>
    page.drawText(s, { x: xr - f.widthOfTextAtSize(s, size), y: yy, size, font: f, color });
  const ruleStr = (ch: string) => {
    const w = font.widthOfTextAtSize(ch, S);
    return ch.repeat(Math.floor((PAGE_W - M * 2) / w));
  };
  const rule = (yy: number, ch = "-") => t(ruleStr(ch), M, yy, S, font, GRAY);

  const docType = jo.isPO ? "P U R C H A S E   O R D E R" : jo.isNonJo ? "N O N - J O" : "J O B   O R D E R";

  const drawHeader = () => {
    t(COMPANY.name.toUpperCase(), M, y, 10, bold);
    tr(docType, amtR, y, 10, bold);
    y -= LH;
    t(`${COMPANY.address}  ·  ${COMPANY.tel}`, M, y, S, font, GRAY);
    tr(jo.joNumber, amtR, y, S, bold);
    y -= LH - 1;
    rule(y, "=");
    y -= LH + 1;

    // Customer + dates block (two columns).
    const midX = 320;
    const cust = jo.customer;
    t(`CUSTOMER : ${cust.name}`, M, y, S, font);
    t(`DATE ORDERED : ${dateStr(jo.createdAt)}`, midX, y, S, font);
    y -= LH;
    t(`CONTACT  : ${cust.contactNumber ?? "—"}`, M, y, S, font);
    t(`DATE NEEDED  : ${dayStr(jo.deadline)}`, midX, y, S, font);
    y -= LH;
    // ADDRESS wraps (never truncated); the right column keeps its own rows.
    const addrPrefix = "ADDRESS  : ";
    const addrIndent = M + font.widthOfTextAtSize(addrPrefix, S);
    const addrLines = wrapToWidth(cust.address ?? "—", midX - 8 - addrIndent, font, S);
    t(`${addrPrefix}${addrLines[0]}`, M, y, S, font);
    t(`TERMS        : ${fin?.paymentTermLabel ?? "—"}`, midX, y, S, font);
    y -= LH;
    for (let k = 1; k < addrLines.length; k++) {
      t(addrLines[k]!, addrIndent, y, S, font);
      y -= LH;
    }
    y += 1;
    rule(y, "-");
    y -= LH;

    // Column header
    t("#", noX, y, S, bold);
    t("DESCRIPTION", descX, y, S, bold);
    tr("QTY", qtyR, y, S, bold);
    tr("SQ FT", sqftR, y, S, bold);
    tr("RATE", rateR, y, S, bold);
    tr("AMOUNT", amtR, y, S, bold);
    y -= LH - 2;
    rule(y, "-");
    y -= LH;
  };

  const startPage = (broughtForward: number | null) => {
    page = doc.addPage([PAGE_W, PAGE_H]);
    pages.push(page);
    y = PAGE_H - M;
    drawHeader();
    if (broughtForward !== null) {
      t("BROUGHT FORWARD", descX, y, S, bold, GRAY);
      tr(money(broughtForward), amtR, y, S, bold);
      y -= LH;
    }
  };

  // Description flows up to just before QTY; the spec sub-line runs wider, up to
  // just before the AMOUNT column. Both WRAP (never truncate).
  const DESC_W = qtyR - 46 - descX;
  const SPEC_W = amtR - 60 - (descX + 2);
  type Prepared = { r: PrintRow; descLines: string[]; specLines: string[]; height: number };
  const prepare = (r: PrintRow): Prepared => {
    const descLines = wrapToWidth(r.desc, DESC_W, font, S);
    const specLines = r.specLine ? wrapToWidth(r.specLine, SPEC_W, font, S) : [];
    const count = descLines.length + specLines.length + (r.chargeLine ? 1 : 0);
    return { r, descLines, specLines, height: count * (LH - 2) + 2 };
  };

  const drawRow = (p: Prepared) => {
    const { r, descLines, specLines } = p;
    t(String(r.no), noX, y, S, font);
    t(descLines[0]!, descX, y, S, font);
    tr(String(r.qty), qtyR, y, S, font);
    if (r.sqft) tr(r.sqft, sqftR, y, S, font);
    if (r.rate) tr(r.rate, rateR, y, S, font);
    tr(money(r.amount), amtR, y, S, font);
    y -= LH - 2;
    for (let k = 1; k < descLines.length; k++) {
      t(descLines[k]!, descX, y, S, font);
      y -= LH - 2;
    }
    for (const s of specLines) {
      t(s, descX + 2, y, S, font, GRAY);
      y -= LH - 2;
    }
    if (r.chargeLine) {
      t(`+ ${r.chargeLine}`, descX + 2, y, S, font, GRAY);
      if (r.chargeAmt != null) tr(money(r.chargeAmt), amtR, y, S, font);
      y -= LH - 2;
    }
    y -= 2;
  };

  const BOTTOM = M + 8; // page floor for the carried-forward line
  const FOOTER_H = 78; // space the totals + acceptance block needs on the last page

  // ——— render items with pagination ———
  const rows = jo.items.map(decodeItem).map(prepare);
  let running = 0;
  startPage(null);
  rows.forEach((p) => {
    if (y - p.height < BOTTOM + LH) {
      // No room for this item — carry the subtotal forward to a new page.
      rule(y, "-");
      y -= LH;
      tr("CARRIED FORWARD", amtR - 120, y, S, bold, GRAY);
      tr(money(running), amtR, y, S, bold);
      startPage(running);
    }
    drawRow(p);
    running += round2(p.r.amount + (p.r.chargeAmt ?? 0));
  });

  // ——— totals footer (needs a block; push to a new page if it won't fit) ———
  if (y - FOOTER_H < BOTTOM) {
    rule(y, "-");
    y -= LH;
    tr("CARRIED FORWARD", amtR - 120, y, S, bold, GRAY);
    tr(money(running), amtR, y, S, bold);
    startPage(running);
  }
  rule(y, "-");
  y -= LH;

  const subtotal = round2(running);
  const tax = fin?.taxType ?? "NON_VAT";
  if (tax === "VAT_INCLUSIVE") {
    const vatable = round2(subtotal / 1.12);
    const vat = round2(subtotal - vatable);
    t(`VATable ${money(vatable)}    VAT 12% ${money(vat)}`, descX, y, S, font, GRAY);
    tr(`TOTAL  ${money(subtotal)}`, amtR, y, S, bold);
    y -= LH;
  } else if (tax === "VAT_EXCLUSIVE") {
    const vat = round2(subtotal * 0.12);
    const grand = round2(subtotal + vat);
    t(`Net ${money(subtotal)}    VAT 12% ${money(vat)}`, descX, y, S, font, GRAY);
    tr(`TOTAL  ${money(grand)}`, amtR, y, S, bold);
    y -= LH;
  } else {
    t("TOTAL", descX, y, S, bold);
    tr(money(subtotal), amtR, y, S, bold);
    y -= LH;
  }
  // Downpayment
  const grand =
    tax === "VAT_EXCLUSIVE" ? round2(subtotal * 1.12) : subtotal;
  if (fin && fin.downpaymentRate > 0) {
    const dp = round2(grand * fin.downpaymentRate);
    const pct = Math.round(fin.downpaymentRate * 100);
    t(`DOWNPAYMENT PAYABLE TO CASHIER (${pct}%)`, descX, y, S, bold);
    tr(money(dp), amtR, y, S, bold);
    y -= LH;
  }
  rule(y, "=");
  y -= LH + 2;

  // ——— conforme + acceptance ———
  t("CONFORME — I confirm the specifications above are correct.", M, y, S, font);
  y -= LH + 8;
  const sig = (label: string, x: number, w: number) => {
    page.drawLine({ start: { x, y: y + 2 }, end: { x: x + w, y: y + 2 }, thickness: 0.7, color: INK });
    t(label, x, y - 8, 7, font, GRAY);
  };
  sig("Customer signature over printed name", M, 200);
  sig("Prepared by", 300, 120);
  sig("Approved by", 440, 120);
  y -= 22;

  // ——— per-page footer: copy labels (last page) + Page X of Y (all pages) ———
  const N = pages.length;
  pages.forEach((p, i) => {
    if (i === N - 1) {
      p.drawText("WHITE COPY — PRODUCTION      PINK COPY — CUSTOMER", {
        x: M,
        y: M - 8,
        size: 7,
        font,
        color: GRAY,
      });
    }
    const label = `Page ${i + 1} of ${N}`;
    p.drawText(label, {
      x: amtR - font.widthOfTextAtSize(label, 7),
      y: M - 8,
      size: 7,
      font,
      color: GRAY,
    });
  });

  return doc.save();
}
