-- The Sales Invoice is ONE document with three labels of use — VAT, Non-VAT
-- and Charge Invoice (docs/sales.txt §3.1) — pre-printed as ONE continuous IN
-- series. A booklet wears a single label, but its numbers carry on from
-- whichever labelled booklet came before it.
--
-- The overlap guard therefore has to key on the NUMBER LINE, not on the label.
-- Keyed on "type" it let a VAT booklet and a Charge booklet both claim
-- IN-0578; keyed on "prefix" — which is exactly what identifies a line, since
-- all three SI labels print "IN" — that collision is impossible.
--
-- Deliberately NOT backfilling "prefix" on existing SI_CHARGE booklets: their
-- issued receipts already carry CI-#### document numbers, and a BIR number
-- that has been handed to a customer is a permanent record.
ALTER TABLE "Booklet" DROP CONSTRAINT "Booklet_no_overlapping_ranges";
ALTER TABLE "Booklet" ADD CONSTRAINT "Booklet_no_overlapping_ranges"
  EXCLUDE USING gist (
    "prefix" WITH =,
    int4range("seriesStart", "seriesEnd", '[]') WITH &&
  );
