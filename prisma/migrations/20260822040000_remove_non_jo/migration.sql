-- AlterEnum
BEGIN;
CREATE TYPE "QuotationType_new" AS ENUM ('SALES', 'PO');
ALTER TABLE "public"."Quotation" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "Quotation" ALTER COLUMN "type" TYPE "QuotationType_new" USING ("type"::text::"QuotationType_new");
ALTER TYPE "QuotationType" RENAME TO "QuotationType_old";
ALTER TYPE "QuotationType_new" RENAME TO "QuotationType";
DROP TYPE "public"."QuotationType_old";
ALTER TABLE "Quotation" ALTER COLUMN "type" SET DEFAULT 'SALES';
COMMIT;

-- AlterTable
ALTER TABLE "JobOrder" DROP COLUMN "isNonJo";
