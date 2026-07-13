-- CreateEnum
CREATE TYPE "PriceRuleType" AS ENUM ('VARIANT', 'ADDON');

-- AlterEnum
ALTER TYPE "InquiryMedium" ADD VALUE 'PORTAL';

-- AlterTable
ALTER TABLE "Inquiry" ADD COLUMN     "email" TEXT;

-- CreateTable
CREATE TABLE "PriceRule" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "type" "PriceRuleType" NOT NULL,
    "label" TEXT NOT NULL,
    "unitPrice" DECIMAL(12,2),
    "minQty" INTEGER NOT NULL DEFAULT 1,
    "minCharge" DECIMAL(12,2),
    "amount" DECIMAL(12,2),
    "pct" DECIMAL(5,2),
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PriceRule_productId_type_isActive_idx" ON "PriceRule"("productId", "type", "isActive");

-- AddForeignKey
ALTER TABLE "PriceRule" ADD CONSTRAINT "PriceRule_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
