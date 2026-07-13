-- CreateEnum
CREATE TYPE "QuotationType" AS ENUM ('SALES', 'PO', 'NON_JO');

-- AlterTable
ALTER TABLE "Quotation" ADD COLUMN     "poNumber" TEXT,
ADD COLUMN     "type" "QuotationType" NOT NULL DEFAULT 'SALES';

-- CreateIndex
CREATE INDEX "Quotation_type_idx" ON "Quotation"("type");
