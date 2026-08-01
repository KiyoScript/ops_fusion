-- Backfill: every receipt issued before split tender existed was paid ONE way.
-- Give each of them the single ReceiptPayment line the new model expects, so
-- "a receipt always has at least one tender line, summing to its amount" holds
-- for history too and the day log never has to special-case old rows.
--
-- Ids are derived from the parent row rather than random, so this is idempotent
-- and a backfilled line is recognisable as one.

INSERT INTO "ReceiptPayment" (
  "id", "saleId", "method", "amount", "reference", "seq", "createdAt"
)
SELECT
  'bfs_' || s."id",
  s."id",
  s."paymentMethod",
  -- amountPaid is the amount applied to the document; fall back to the gross
  -- for any legacy row that never had it set.
  COALESCE(NULLIF(s."amountPaid", 0), s."amount"),
  s."methodDetail",
  0,
  s."createdAt"
FROM "Sale" s
WHERE s."paymentMethod" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "ReceiptPayment" p WHERE p."saleId" = s."id"
  );

INSERT INTO "ReceiptPayment" (
  "id", "collectionReceiptId", "method", "amount", "reference", "seq", "createdAt"
)
SELECT
  'bfc_' || c."id",
  c."id",
  c."method",
  c."amount",
  c."methodDetail",
  0,
  c."createdAt"
FROM "CollectionReceipt" c
WHERE NOT EXISTS (
  SELECT 1 FROM "ReceiptPayment" p WHERE p."collectionReceiptId" = c."id"
);
