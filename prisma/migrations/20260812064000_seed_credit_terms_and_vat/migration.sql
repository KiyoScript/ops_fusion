-- Seed the default credit-term options (30 / 60 / 90 days). Idempotent.
INSERT INTO "CreditTerm" ("id", "days", "isActive", "sortOrder", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 30, true, 0, now(), now()),
  (gen_random_uuid()::text, 60, true, 1, now(), now()),
  (gen_random_uuid()::text, 90, true, 2, now(), now())
ON CONFLICT ("days") DO NOTHING;

-- Backfill Customer.vatStatus from the legacy vatRegistered boolean:
--   registered -> VAT; not registered -> NON_VAT if it has a TIN, else NO_TIN.
UPDATE "Customer" SET "vatStatus" = 'VAT'
  WHERE "vatRegistered" = true AND "vatStatus" IS NULL;
UPDATE "Customer" SET "vatStatus" =
  CASE WHEN "tin" IS NULL OR btrim("tin") = '' THEN 'NO_TIN'::"VatStatus"
       ELSE 'NON_VAT'::"VatStatus" END
  WHERE "vatRegistered" = false AND "vatStatus" IS NULL;
