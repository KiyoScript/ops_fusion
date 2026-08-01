-- CreateTable
CREATE TABLE "ReceiptPayment" (
    "id" TEXT NOT NULL,
    "saleId" TEXT,
    "collectionReceiptId" TEXT,
    "method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reference" TEXT,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReceiptPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReceiptPayment_saleId_idx" ON "ReceiptPayment"("saleId");

-- CreateIndex
CREATE INDEX "ReceiptPayment_collectionReceiptId_idx" ON "ReceiptPayment"("collectionReceiptId");

-- CreateIndex
CREATE INDEX "ReceiptPayment_method_idx" ON "ReceiptPayment"("method");

-- AddForeignKey
ALTER TABLE "ReceiptPayment" ADD CONSTRAINT "ReceiptPayment_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptPayment" ADD CONSTRAINT "ReceiptPayment_collectionReceiptId_fkey" FOREIGN KEY ("collectionReceiptId") REFERENCES "CollectionReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
