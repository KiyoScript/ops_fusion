-- CreateEnum
CREATE TYPE "TaxType" AS ENUM ('NON_VAT', 'VAT_EXCLUSIVE', 'VAT_INCLUSIVE');

-- AlterTable
ALTER TABLE "Quotation" ADD COLUMN     "downpaymentRate" DECIMAL(3,2) NOT NULL DEFAULT 0.5,
ADD COLUMN     "paymentTermLabel" TEXT,
ADD COLUMN     "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "taxType" "TaxType" NOT NULL DEFAULT 'NON_VAT';
