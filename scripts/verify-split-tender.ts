/**
 * Split tender — the payment lines must add up to the amount being invoiced
 * unless the cashier says otherwise.
 *
 * The defect this guards: a cashier splits ₱2,360.40 into ₱1,000 cash and
 * ₱1,000 GCash, and the ₱360.40 they never meant to leave open becomes utang
 * on the A/R ledger. Under the follower rule the second line carries the
 * balance by itself, and utang only happens when every line is typed short.
 *
 * Run: npx tsx scripts/verify-split-tender.ts
 */
import {
  followerIndexOf,
  remainderFor,
  resolveTenders,
} from "../src/modules/sales-audit/services/split-tender";

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  if (ok) {
    console.log(`  ✓ ${label}`);
    return;
  }
  failures++;
  console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
};

type L = { method: string; amount: string };
const line = (method: string, amount = ""): L => ({ method, amount });
const totalOf = (ls: { amount: string }[]) =>
  ls.reduce((t, l) => t + Number(l.amount || 0), 0);

const DUE = 2360.4; // the job order from the screenshot

function main() {
  console.log("\nSplit tender — the follower rule\n");

  // ── 1. One blank line mirrors the amount, exactly as it always did. ──
  {
    const { shown, tenders } = resolveTenders([line("CASH")], DUE, false);
    check(shown[0]!.amount === "2360.40", "a single blank line mirrors the amount");
    check(totalOf(tenders) === DUE, "…and is the only tender");
  }

  // ── 2. THE SCREENSHOT. Split, then reduce the cash line: the second line
  //      takes up the difference instead of leaving ₱360.40 on utang. ──
  {
    const split = [line("CASH", "1000"), line("GCASH")];
    const { shown, tenders } = resolveTenders(split, DUE, false);
    check(
      shown[1]!.amount === "1360.40",
      "₱1,000 cash leaves ₱1,360.40 for the following line",
      `got ${shown[1]!.amount}`
    );
    check(
      Math.abs(totalOf(tenders) - DUE) < 0.005,
      "…so the split adds up to the document exactly",
      `got ${totalOf(tenders)}`
    );
  }

  // ── 3. Utang is still reachable — but only by typing BOTH lines short.
  //      This is the old screenshot behaviour, now a deliberate act. ──
  {
    const typed = [line("CASH", "1000"), line("GCASH", "1000")];
    const { tenders } = resolveTenders(typed, DUE, false);
    check(followerIndexOf(typed, false) === -1, "no line follows once both are typed");
    check(
      Math.abs(totalOf(tenders) - 2000) < 0.005,
      "…received is ₱2,000, leaving ₱360.40 on utang as chosen",
      `got ${totalOf(tenders)}`
    );
  }

  // ── 4. Adding a line must not silently zero the one already on screen.
  //      Simulating addLine: freeze the follower, append a blank. ──
  {
    const before = [line("CASH")];
    const frozen = before.map((l, i) =>
      i === followerIndexOf(before, false)
        ? { ...l, amount: remainderFor(before, i, DUE) }
        : l
    );
    const after = [...frozen, line("GCASH")];
    check(after[0]!.amount === "2360.40", "the first line keeps its figure when a line is added");

    const { shown, tenders } = resolveTenders(after, DUE, false);
    check(shown[1]!.amount === "0.00", "the new line starts at 0.00 — the first covers it all");
    check(
      tenders.length === 1,
      "…and an empty follower is not submitted as a ₱0 tender",
      `got ${tenders.length} tenders`
    );
    check(
      Math.abs(totalOf(tenders) - DUE) < 0.005,
      "…so the receipt is still issuable straight away"
    );
  }

  // ── 5. Clearing a line hands it back to following. ──
  {
    const cleared = [line("CASH", "1000"), line("GCASH", "")];
    const { shown } = resolveTenders(cleared, DUE, false);
    check(shown[1]!.amount === "1360.40", "clearing a line makes it follow again");
  }

  // ── 6. A Charge Invoice records credit — nothing is received against it. ──
  {
    const { tenders, followerIndex } = resolveTenders([], DUE, true);
    check(followerIndex === -1 && tenders.length === 0, "a charge invoice has no tenders");
    const withLine = resolveTenders([line("CASH")], DUE, true);
    check(
      withLine.shown[0]!.amount === "",
      "…and no line follows the amount on one"
    );
  }

  // ── 7. Over-tender: the follower never creates change, the typed line does. ──
  {
    const over = [line("CASH", "3000"), line("GCASH")];
    const { shown, tenders } = resolveTenders(over, DUE, false);
    check(shown[1]!.amount === "0.00", "an over-tendered line leaves the follower at zero");
    check(
      Math.abs(totalOf(tenders) - 3000) < 0.005,
      "…and the overpayment stands, for change to be given on"
    );
  }

  // ── 8. Three ways, the last one still balancing the document. ──
  {
    const three = [line("CASH", "1000"), line("CHECK", "500"), line("GCASH")];
    const { shown, tenders } = resolveTenders(three, DUE, false);
    check(shown[2]!.amount === "860.40", "a three-way split balances on the last line", `got ${shown[2]!.amount}`);
    check(Math.abs(totalOf(tenders) - DUE) < 0.005, "…and still totals the document");
  }

  // ── 9. No float drift on an awkward amount. ──
  {
    const awkward = [line("CASH", "0.10"), line("GCASH")];
    const { shown, tenders } = resolveTenders(awkward, 0.3, false);
    check(shown[1]!.amount === "0.20", "0.30 less 0.10 is 0.20, not 0.19999…", `got ${shown[1]!.amount}`);
    check(
      totalOf(tenders).toFixed(2) === "0.30",
      "…and the lines still total the amount"
    );
  }

  console.log("");
}

main();
console.log(failures === 0 ? "PASS\n" : `FAIL — ${failures} case(s)\n`);
process.exit(failures === 0 ? 0 : 1);
