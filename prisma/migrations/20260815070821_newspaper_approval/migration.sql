-- CreateEnum
CREATE TYPE "NewspaperRowStatus" AS ENUM ('PENDING', 'APPROVED');

-- AlterTable
ALTER TABLE "NewspaperPriceRow" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "status" "NewspaperRowStatus" NOT NULL DEFAULT 'APPROVED',
ADD COLUMN     "submittedById" TEXT;

-- CreateIndex
CREATE INDEX "NewspaperPriceRow_status_idx" ON "NewspaperPriceRow"("status");
