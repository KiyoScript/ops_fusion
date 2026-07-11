-- CreateIndex
CREATE INDEX "DeliveryReceipt_issuedAt_idx" ON "DeliveryReceipt"("issuedAt");

-- CreateIndex
CREATE INDEX "DeliveryReceipt_status_issuedAt_idx" ON "DeliveryReceipt"("status", "issuedAt");
