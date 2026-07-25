import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { format } from "date-fns";
import { COMPANY } from "@/lib/company";
import type { JobOrderDetailDto, ProductionStepLine } from "../schemas/job-order";

// Internal PRODUCTION copy of a Job Order — NOT the customer-approval printable
// (that's jo-pdf.ts). Shares the Ormoc Printshoppe branded header, but the body
// is the production worksheet: each line item with its spec breakdown AND its
// production-step checklist (Layout → Printing → Finishing …), then blank
// endorsement / acceptance lines the floor staff sign by hand.

const PAGE_W = 595.28; // A4 portrait, points
const PAGE_H = 841.89;
const M = 44;
const DARK = rgb(0.27, 0.27, 0.27);
const RED = rgb(0.8, 0, 0);
const INK = rgb(0.08, 0.08, 0.08);
const GRAY = rgb(0.42, 0.42, 0.42);
const BORDER = rgb(0.62, 0.62, 0.62);
const LIGHT = rgb(0.82, 0.82, 0.82);

const CONTACT_LINE =
  "If you have any questions, please contact Michelle Ca-ang, 0963-1220016, ormocprintshoppe@gmail.com";
const COMPANY_EMAIL = "ormocprintshoppe@gmail.com";

const dateStr = (iso: string | null): string =>
  iso ? format(new Date(iso), "MMMM d, yyyy") : "—";
const dayStr = (d: string | null): string =>
  d ? format(new Date(`${d}T00:00:00`), "MMMM d, yyyy") : "—";

async function loadLogo(): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(
      await readFile(path.join(process.cwd(), "public", "printshoppe-logo.png"))
    );
  } catch {
    return null;
  }
}

export async function renderJoProductionPdf(
  jo: JobOrderDetailDto,
  stepsByItem: Record<string, ProductionStepLine[]>
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page = doc.addPage([PAGE_W, PAGE_H]);
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
  ) => page.drawText(value, { x: rightX - f.widthOfTextAtSize(value, size), y: yy, size, font: f, color });
  const bar = (x: number, yy: number, w: number, h: number, color = DARK) =>
    page.drawRectangle({ x, y: yy, width: w, height: h, color });
  const box = (x: number, yy: number, w: number, h: number, borderColor = BORDER) =>
    page.drawRectangle({ x, y: yy, width: w, height: h, borderColor, borderWidth: 0.8 });
  const hline = (yy: number, color = LIGHT, x1 = M, x2 = PAGE_W - M) =>
    page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness: 0.8, color });

  const footer = (p: PDFPage) =>
    p.drawText(CONTACT_LINE, {
      x: (PAGE_W - font.widthOfTextAtSize(CONTACT_LINE, 7)) / 2,
      y: M - 18,
      size: 7,
      font,
      color: rgb(0.35, 0.45, 0.6),
    });

  const sectionBar = (label: string) => {
    bar(M, y - 13, PAGE_W - M * 2, 13);
    page.drawText(label, { x: M + 8, y: y - 9.5, size: 7.5, font: bold, color: rgb(1, 1, 1) });
    y -= 24;
  };

  // Start a fresh page when the next block wouldn't fit above the footer.
  const ensure = (needed: number) => {
    if (y - needed < M + 40) {
      footer(page);
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - M;
      text(`${jo.joNumber} — PRODUCTION (cont.)`, M, y, 9, bold, GRAY);
      y -= 18;
      hline(y, DARK);
      y -= 16;
    }
  };

  // ——— header ———
  const logoBytes = await loadLogo();
  if (logoBytes) {
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
  rightText("PRODUCTION COPY", PAGE_W - M, y - 32, 9, bold, RED);
  rightText(jo.joNumber, PAGE_W - M, y - 45, 11, bold);

  const boxRight = PAGE_W - M;
  const valueW = 108;
  const labelW = 74;
  const rowH = 15;
  let boxY = y - 62;
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
    page.drawText(value, { x: boxRight - valueW + (valueW - v) / 2, y: boxY + 4, size: 8.5, font, color: INK });
    boxY -= rowH + 4;
  };
  dateRow("DATE", dateStr(jo.createdAt));
  dateRow("DEADLINE", dayStr(jo.deadline));

  y -= 104;
  hline(y, DARK);
  y -= 16;

  // ——— customer + job details ———
  const detW = 218;
  const detX = PAGE_W - M - detW;

  bar(M, y - 13, 150, 13);
  page.drawText("CUSTOMER", { x: M + 8, y: y - 9.5, size: 7.5, font: bold, color: rgb(1, 1, 1) });
  let custY = y - 28;
  text(jo.customer.name, M, custY, 12, bold);
  custY -= 13;
  for (const meta of [jo.customer.contactNumber, jo.customer.address].filter(
    (v): v is string => !!v
  )) {
    for (const line of wrap(meta, font, 8.5, detX - M - 14)) {
      text(line, M, custY, 8.5);
      custY -= 11;
    }
  }

  // JOB DETAILS box (Status / Items / Prepared by) removed from the production
  // copy per ruling 2026-07-24 — the floor worksheet doesn't need it.
  y -= y - custY + 18;

  // ——— items & production steps ———
  sectionBar("ITEMS & PRODUCTION WORKFLOW");
  const contentW = PAGE_W - M * 2;

  jo.items.forEach((item, index) => {
    const parts = item.jobDescription.split(" · ");
    const service = parts[0] ?? "";
    const restParts = parts.slice(1);
    const meta: string[] = [`Qty: ${item.qty}`];
    if (item.assignedTo) meta.push(`Assigned: ${item.assignedTo}`);
    if (item.category) meta.push(item.category);
    if (item.deadline) meta.push(`Due ${dayStr(item.deadline)}`);
    if (item.isRush) meta.push("RUSH");
    const steps = stepsByItem[item.id] ?? [];

    // Height estimate for this item block (title + attrs + meta + steps).
    const attrLines = restParts.flatMap((p) => wrap(p, font, 8, contentW - 16));
    const blockH =
      16 + attrLines.length * 10 + 12 + Math.max(steps.length, 1) * 13 + 18;
    ensure(blockH);

    box(M, y - blockH + 6, contentW, blockH);
    let iy = y - 8;
    text(`${index + 1}.  ${service}`, M + 8, iy, 9.5, bold);
    text(item.lineItemId ?? "", PAGE_W - M - 8 - font.widthOfTextAtSize(item.lineItemId ?? "", 7.5), iy, 7.5, font, GRAY);
    iy -= 13;
    for (const line of attrLines) {
      text(line, M + 12, iy, 8, font, rgb(0.25, 0.25, 0.25));
      iy -= 10;
    }
    text(meta.join("  ·  "), M + 12, iy, 7.5, font, GRAY);
    iy -= 14;

    // Production-step checklist.
    text("PRODUCTION STEPS", M + 12, iy, 6.5, bold, GRAY);
    iy -= 12;
    if (steps.length === 0) {
      text("No production steps set for this item.", M + 24, iy, 8, font, GRAY);
      iy -= 13;
    } else {
      for (const step of steps) {
        // checkbox
        page.drawRectangle({
          x: M + 24,
          y: iy - 1.5,
          width: 8,
          height: 8,
          borderColor: INK,
          borderWidth: 0.8,
          color: step.done ? INK : undefined,
        });
        text(
          step.name,
          M + 38,
          iy,
          8.5,
          font,
          step.done ? GRAY : INK
        );
        if (step.done) text("done", PAGE_W - M - 8 - font.widthOfTextAtSize("done", 7), iy, 7, font, GRAY);
        iy -= 13;
      }
    }
    y -= blockH;
  });

  // ——— endorsement / acceptance (blank, handwritten) ———
  y -= 8;
  ensure(96);
  sectionBar("ENDORSEMENT & ACCEPTANCE");
  const fill = (label: string, x: number, yy: number, w: number) => {
    page.drawLine({ start: { x: x + font.widthOfTextAtSize(label, 8) + 6, y: yy }, end: { x: x + w, y: yy }, thickness: 0.8, color: INK });
    text(label, x, yy + 3, 8, font, GRAY);
  };
  fill("Endorsed to", M, y - 6, 250);
  text("for print", M + 258, y - 3, 8, font, GRAY);
  y -= 26;
  fill("C/O", M, y - 6, 250);
  y -= 26;
  fill("Accepted by", M, y - 6, 200);
  fill("Accepted date", M + 280, y - 6, 200);
  y -= 26;
  fill("Needed by", M, y - 6, 200);
  text(dayStr(jo.deadline), M + 70, y - 3, 8, bold);

  footer(page);
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
