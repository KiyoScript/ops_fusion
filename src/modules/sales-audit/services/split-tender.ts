// ══════════════════════════════════════════════════════════════════════════
// SPLIT TENDER — which line follows the amount, and what it carries.
//
// The counter rule, in one sentence: one payment line FOLLOWS the amount
// being invoiced, absorbing whatever the typed lines leave uncovered, so a
// split adds up to the document by default.
//
// Why this lives here rather than in the dialog: it decides how much money is
// recorded against a receipt. A cashier who splits ₱2,360.40 into ₱1,000 cash
// and leaves the second line blank must not silently issue a ₱2,360.40
// document against ₱1,000 received — that difference becomes utang on the A/R
// ledger, and it should only ever get there because somebody chose it.
//
// Utang stays fully reachable: type a smaller figure into every line and the
// shortfall is real, intended, and still opens a receivable exactly as before.
// ══════════════════════════════════════════════════════════════════════════

/** A tender line as the counter holds it, before the server sees it. */
export type SplitLine = {
  amount: string;
};

/** Peso string → number. Blank and junk read as zero, as the counter does. */
function num(v: string): number {
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

const cent = (v: number) => Math.round(v * 100);

/**
 * Which line follows the amount: the LAST one left blank.
 *
 * Blank is the whole signal — no separate "touched" flag to keep in step.
 * Typing in a line claims it; clearing it hands it back to following. The last
 * blank rather than the first because a newly added line is appended, and the
 * line the cashier just created is the one they mean to fill.
 *
 * A Charge Invoice has no follower: it records a sale on credit, so nothing is
 * received against it and there are no lines to carry anything.
 */
export function followerIndexOf(
  lines: SplitLine[],
  isCharge: boolean
): number {
  if (isCharge) return -1;
  return lines.reduce(
    (found, l, i) => (l.amount.trim() === "" ? i : found),
    -1
  );
}

/**
 * What the following line has to carry for the split to add up: the amount
 * being invoiced, less everything the other lines already cover.
 *
 * Floored at zero. Over-tendering is a change-at-the-counter question and it
 * is the typed lines that raise it — a line that is only filling a gap can
 * never be the one that creates an overpayment.
 */
export function remainderFor(
  lines: SplitLine[],
  self: number,
  due: number
): string {
  const others = lines.reduce(
    (t, l, i) => (i === self ? t : t + num(l.amount)),
    0
  );
  return Math.max(due - others, 0).toFixed(2);
}

export type ResolvedTenders<T extends SplitLine> = {
  /** Every line as it should appear on screen, follower filled in. */
  shown: T[];
  /**
   * The lines that are actually money. Identical to `shown`, minus a follower
   * with nothing left to absorb — that one is an empty row waiting to be
   * filled, not a tender of ₱0, and treating it as a tender would block the
   * receipt until the cashier had typed into every line they added.
   */
  tenders: T[];
  followerIndex: number;
};

/**
 * Resolve the counter's typed lines into what is shown and what is recorded.
 *
 * The two differ in exactly one case (the empty follower), and keeping them
 * as separate arrays is deliberate: the screen should show the row so it can
 * be filled, and the receipt should not carry it.
 */
export function resolveTenders<T extends SplitLine>(
  lines: T[],
  due: number,
  isCharge: boolean
): ResolvedTenders<T> {
  const followerIndex = followerIndexOf(lines, isCharge);
  const shown = lines.map((l, i) =>
    i === followerIndex ? { ...l, amount: remainderFor(lines, i, due) } : l
  );
  const tenders = shown.filter(
    (l, i) => !(i === followerIndex && cent(num(l.amount)) <= 0)
  );
  return { shown, tenders, followerIndex };
}
