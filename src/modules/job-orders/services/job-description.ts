// Composes a JO line item's "Job Description" from its STRUCTURED fields
// (service · size · qty · price breakdown) so it stays in sync with qty instead
// of being a frozen string with the quantity baked in. The pricing detail comes
// from the quote line's `specs` (per calculator); items without usable specs
// (manually-encoded / non-quote lines) fall back to their typed description.

type Specs = Record<string, unknown>;

const asNum = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const asStr = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

const round2 = (n: number) => Math.round(n * 100) / 100;
const trimNum = (n: number): string => (Number.isInteger(n) ? String(n) : String(round2(n)));

// "P1,600.00" — StandardFonts have no ₱ glyph, and this matches the PDF/UI.
const peso = (v: number | string): string => {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n)
    ? `P${n.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`
    : String(v);
};

const titleCase = (s: string): string =>
  s.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const firstSegment = (s: string): string => (s.split(/ · | — /)[0] ?? s).trim();

export interface ComposeInput {
  productName?: string | null;
  specs?: unknown; // Prisma JsonValue from the JO item
  qty: number;
  unitPrice: string | number;
  lineTotal: string | number;
  fallback: string; // the item's typed/stored description
}

/** Builds the live "Job Description" string for a JO line item. */
export function composeJobDescription(input: ComposeInput): string {
  const specs =
    input.specs && typeof input.specs === "object" && !Array.isArray(input.specs)
      ? (input.specs as Specs)
      : null;
  // No structured data to compose from → keep the typed description verbatim.
  if (!specs) return input.fallback;

  const calc = asStr(specs.calculator);
  const service =
    asStr(specs.product) ??
    (input.productName?.trim() || null) ??
    (calc ? titleCase(calc) : null) ??
    firstSegment(input.fallback);

  // size — width×height, else a computed area
  const w = asNum(specs.width);
  const h = asNum(specs.height);
  const unit = asStr(specs.unit) ?? "";
  const area = asNum(specs.area);
  const withUnit = (s: string) => (unit ? `${s} ${unit}` : s);
  let size: string | null = null;
  if (w && h) size = withUnit(`${trimNum(w)} × ${trimNum(h)}`);
  else if (area) size = withUnit(trimNum(area));

  const attributes: string[] = [];
  const pricing: string[] = [];

  if (calc === "tarpaulin") {
    const eyelet = asStr(specs.eyelet);
    if (eyelet && eyelet.toLowerCase() !== "no eyelet") attributes.push(`Eyelet: ${eyelet}`);
    const rate = asNum(specs.ratePerSqft);
    const sqftPerPc = asNum(specs.sqftPerPc);
    if (rate && sqftPerPc) {
      pricing.push(`${peso(rate)}/sqft × ${trimNum(round2(sqftPerPc * input.qty))} sqft`);
    }
    // Current shape: specs.addons = [{ label, fee }]. Legacy: rush/design.
    const addons = Array.isArray(specs.addons)
      ? (specs.addons as { label?: unknown; fee?: unknown }[])
      : [];
    if (addons.length > 0) {
      for (const a of addons) {
        const label = asStr(a?.label);
        const fee = asNum(a?.fee);
        if (label) pricing.push(`${label}${fee != null ? ` ${peso(fee)}` : ""}`);
      }
    } else {
      if (specs.rush) pricing.push(`Rush ${peso(asNum(specs.rushFee) ?? 0)}`);
      if (specs.design) pricing.push(`Design ${peso(asNum(specs.designFee) ?? 0)}`);
    }
  } else if (calc === "generic") {
    const variant = asStr(specs.variant);
    if (variant) attributes.push(variant);
    if (Array.isArray(specs.addons)) {
      for (const a of specs.addons) {
        const label = asStr(a);
        if (label) attributes.push(label);
      }
    }
    pricing.push(`${peso(input.unitPrice)} × ${input.qty}`);
  } else {
    // Any other calculator: a simple unit-price × qty breakdown.
    pricing.push(`${peso(input.unitPrice)} × ${input.qty}`);
  }

  const head = [service, size, ...attributes, `Qty ${input.qty}`]
    .filter((p): p is string => !!p)
    .join(" · ");
  const breakdown = pricing.join(" + ");
  const total = peso(input.lineTotal);
  return breakdown ? `${head} · ${breakdown} = ${total}` : `${head} · ${total}`;
}
