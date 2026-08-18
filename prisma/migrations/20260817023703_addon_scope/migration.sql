-- CreateEnum
CREATE TYPE "AddonScope" AS ENUM ('PER_LINE_ITEM', 'WHOLE_JO');

-- AlterTable
ALTER TABLE "PriceRule" ADD COLUMN     "scope" "AddonScope" NOT NULL DEFAULT 'PER_LINE_ITEM';
