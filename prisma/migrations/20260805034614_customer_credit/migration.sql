-- AlterTable
ALTER TABLE "AdvancePayment" ADD COLUMN     "sourceCollectionReceiptId" TEXT;

-- AlterTable
ALTER TABLE "AdvancePaymentApplication" ADD COLUMN     "collectionReceiptId" TEXT;

-- CreateIndex
CREATE INDEX "AdvancePayment_sourceCollectionReceiptId_idx" ON "AdvancePayment"("sourceCollectionReceiptId");

-- CreateIndex
CREATE INDEX "AdvancePaymentApplication_collectionReceiptId_idx" ON "AdvancePaymentApplication"("collectionReceiptId");

-- AddForeignKey
ALTER TABLE "AdvancePayment" ADD CONSTRAINT "AdvancePayment_sourceCollectionReceiptId_fkey" FOREIGN KEY ("sourceCollectionReceiptId") REFERENCES "CollectionReceipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvancePaymentApplication" ADD CONSTRAINT "AdvancePaymentApplication_collectionReceiptId_fkey" FOREIGN KEY ("collectionReceiptId") REFERENCES "CollectionReceipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
