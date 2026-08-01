-- CreateEnum
CREATE TYPE "ReceiptVoidType" AS ENUM ('CANCELLED', 'VOID', 'REPLACED');

-- AlterTable
ALTER TABLE "CollectionReceipt" ADD COLUMN     "replacedById" TEXT,
ADD COLUMN     "voidReason" TEXT,
ADD COLUMN     "voidType" "ReceiptVoidType",
ADD COLUMN     "voidedAt" TIMESTAMP(3),
ADD COLUMN     "voidedById" TEXT;

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "replacedById" TEXT,
ADD COLUMN     "voidReason" TEXT,
ADD COLUMN     "voidType" "ReceiptVoidType",
ADD COLUMN     "voidedAt" TIMESTAMP(3),
ADD COLUMN     "voidedById" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "CollectionReceipt_replacedById_key" ON "CollectionReceipt"("replacedById");

-- CreateIndex
CREATE INDEX "CollectionReceipt_voidedAt_idx" ON "CollectionReceipt"("voidedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_replacedById_key" ON "Sale"("replacedById");

-- CreateIndex
CREATE INDEX "Sale_voidedAt_idx" ON "Sale"("voidedAt");

-- AddForeignKey
ALTER TABLE "CollectionReceipt" ADD CONSTRAINT "CollectionReceipt_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionReceipt" ADD CONSTRAINT "CollectionReceipt_replacedById_fkey" FOREIGN KEY ("replacedById") REFERENCES "CollectionReceipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_replacedById_fkey" FOREIGN KEY ("replacedById") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;
