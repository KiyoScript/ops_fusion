-- Data migration: seed Product.isLFP from the legacy LFP service categories.
-- LFP used to live on the JO_CATEGORY lookup (LookupOption.isLFP); it now lives
-- on the product. Flag a product as LFP when its category clearly indicates
-- large-format work: either the "Large Format" catch-all, or a category name
-- that matches an LFP-marked JO_CATEGORY. Everything else stays false and is
-- set per-product via the new toggle in Products & Services.
UPDATE "Product" p
SET "isLFP" = true
WHERE p."deletedAt" IS NULL
  AND (
    lower(btrim(p."category")) = 'large format'
    OR EXISTS (
      SELECT 1
      FROM "LookupOption" l
      WHERE l."type" = 'JO_CATEGORY'
        AND l."isLFP" = true
        AND lower(btrim(l."label")) = lower(btrim(p."category"))
    )
  );
