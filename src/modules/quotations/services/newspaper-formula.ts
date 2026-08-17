// Pure newspaper pricing FORMULA — decoded 1:1 from the "Formula" sheet of
// "Newspaper Computation 2026.xlsx". No Prisma / server imports, so it is safe
// to reuse in client components (the maintenance sandbox calculator) as the
// single source of truth for the math. The DB engine (newspaper-pricing.ts)
// re-exports everything here.

export const round2 = (n: number): number => Math.round(n * 100) / 100;

export type FormulaParams = {
  pricePerPlate: number; // F4 — Price Per Plate
  laborPerPlate: number; // F5 — Labor per Plate
  paperRate: number; // F6 — Paper (per sheet)
  runningRate: number; // F7 — Running per plate
  marginPct: number; // F8 — Percentage Margin (fraction, 0.5 = 50%)
};

// Fixed guide, editable only in the local sandbox — never DB-persisted.
export const DEFAULT_FORMULA_PARAMS: FormulaParams = {
  pricePerPlate: 400,
  laborPerPlate: 150,
  paperRate: 0.7,
  runningRate: 425,
  marginPct: 0.5,
};

export type FormulaInput = {
  totalPages: number; // D2 — # of Pages
  colorPages: number; // B3 — # of Colored
  bwPages: number; // D3 — # of BW
  copies: number; // B2 — # of Copies
};

export type FormulaBreakdown = {
  platesColor: number; // B4  = colorPages/2*4
  platesBW: number; // B5  = bwPages/2
  totalPlates: number; // B6  = SUM(B4:B5)
  paperSheets: number; // B7  = copies*pages
  plateColorCost: number; // C4  = B4*F4
  plateBWCost: number; // C5  = B5*F4
  plateCost: number; // C4+C5
  laborCost: number; // C6  = B6*F5
  paperCost: number; // C7  = B7*F6
  runningCost: number; // C8  = B8(=B6)*F7
  subtotal: number; // C9  = SUM(C4:C8)
  margin: number; // C10 = C9*F8
};

/**
 * The decoded formula (Formula sheet). Verified vs the sheet example:
 * 300 copies · 12 pages · 8 color · 4 BW → total ₱30,105 · ₱100.35/copy.
 *   platesColor = colorPages/2*4  (= colorPages*2); platesBW = bwPages/2
 *   plate+labor+running are per-plate; paper is copies*pages*rate; +margin%.
 */
export function computeFormula(
  spec: FormulaInput,
  p: FormulaParams
): { total: number; perCopy: number; breakdown: FormulaBreakdown } {
  const platesColor = (spec.colorPages / 2) * 4; // B4
  const platesBW = spec.bwPages / 2; // B5
  const totalPlates = platesColor + platesBW; // B6
  const paperSheets = spec.copies * spec.totalPages; // B7
  const plateColorCost = round2(platesColor * p.pricePerPlate); // C4
  const plateBWCost = round2(platesBW * p.pricePerPlate); // C5
  const plateCost = round2(plateColorCost + plateBWCost);
  const laborCost = round2(totalPlates * p.laborPerPlate); // C6
  const paperCost = round2(paperSheets * p.paperRate); // C7
  const runningCost = round2(totalPlates * p.runningRate); // C8
  const subtotal = round2(plateCost + laborCost + paperCost + runningCost); // C9
  const margin = round2(subtotal * p.marginPct); // C10
  const total = round2(subtotal + margin); // C11
  const perCopy = spec.copies > 0 ? round2(total / spec.copies) : 0; // C12
  return {
    total,
    perCopy,
    breakdown: {
      platesColor,
      platesBW,
      totalPlates,
      paperSheets,
      plateColorCost,
      plateBWCost,
      plateCost,
      laborCost,
      paperCost,
      runningCost,
      subtotal,
      margin,
    },
  };
}
