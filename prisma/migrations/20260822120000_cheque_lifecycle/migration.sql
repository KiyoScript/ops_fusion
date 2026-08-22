-- A cheque is not money until it clears. Tracking it from the counter to the
-- bank is what stops a returned cheque from silently closing a receivable.

-- CreateEnum
CREATE TYPE "ChequeStatus" AS ENUM ('RECEIVED', 'DEPOSITED', 'CLEARED', 'BOUNCED');

-- CreateTable
CREATE TABLE "Cheque" (
    "id" TEXT NOT NULL,
    "receiptPaymentId" TEXT NOT NULL,
    "chequeNo" TEXT NOT NULL,
    "bank" TEXT,
    "chequeDate" TIMESTAMP(3),
    "status" "ChequeStatus" NOT NULL DEFAULT 'RECEIVED',
    "depositSlipNo" TEXT,
    "depositedAt" TIMESTAMP(3),
    "depositedById" TEXT,
    "clearedAt" TIMESTAMP(3),
    "clearedById" TEXT,
    "bouncedAt" TIMESTAMP(3),
    "bouncedById" TEXT,
    "bounceReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cheque_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Cheque_receiptPaymentId_key" ON "Cheque"("receiptPaymentId");

-- CreateIndex
CREATE INDEX "Cheque_status_idx" ON "Cheque"("status");

-- CreateIndex
CREATE INDEX "Cheque_chequeDate_idx" ON "Cheque"("chequeDate");

-- CreateIndex
CREATE INDEX "Cheque_depositSlipNo_idx" ON "Cheque"("depositSlipNo");

-- AddForeignKey
ALTER TABLE "Cheque" ADD CONSTRAINT "Cheque_receiptPaymentId_fkey" FOREIGN KEY ("receiptPaymentId") REFERENCES "ReceiptPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cheque" ADD CONSTRAINT "Cheque_depositedById_fkey" FOREIGN KEY ("depositedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cheque" ADD CONSTRAINT "Cheque_clearedById_fkey" FOREIGN KEY ("clearedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cheque" ADD CONSTRAINT "Cheque_bouncedById_fkey" FOREIGN KEY ("bouncedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
