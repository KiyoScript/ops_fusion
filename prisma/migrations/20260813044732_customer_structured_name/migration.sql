-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "firstName" TEXT,
ADD COLUMN     "lastName" TEXT,
ADD COLUMN     "middleInitial" TEXT;

-- Backfill: seed lastName from the existing free-text name so search + edit
-- prefill have something to work with. `name` (the display) is left untouched;
-- staff re-split into first/last over time (structure enforced on new/edited).
UPDATE "Customer" SET "lastName" = "name" WHERE "lastName" IS NULL;
