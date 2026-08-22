-- AlterTable
ALTER TABLE "CrAllocation" ADD COLUMN     "certificateId" TEXT,
ADD COLUMN     "ewtWithheld" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "ewtRatePct" DECIMAL(5,2),
ADD COLUMN     "isWithholdingAgent" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "WithholdingCertificate" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "certificateNo" TEXT,
    "periodFrom" DATE,
    "periodTo" DATE,
    "amount" DECIMAL(12,2) NOT NULL,
    "taxBase" DECIMAL(12,2),
    "ratePct" DECIMAL(5,2),
    "receivedAt" TIMESTAMP(3),
    "fileName" TEXT,
    "mimeType" TEXT,
    "fileSize" INTEGER,
    "fileData" BYTEA,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,

    CONSTRAINT "WithholdingCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WithholdingCertificate_certificateNo_key" ON "WithholdingCertificate"("certificateNo");

-- CreateIndex
CREATE INDEX "WithholdingCertificate_customerId_idx" ON "WithholdingCertificate"("customerId");

-- CreateIndex
CREATE INDEX "WithholdingCertificate_receivedAt_idx" ON "WithholdingCertificate"("receivedAt");

-- CreateIndex
CREATE INDEX "WithholdingCertificate_deletedAt_idx" ON "WithholdingCertificate"("deletedAt");

-- CreateIndex
CREATE INDEX "WithholdingCertificate_createdById_idx" ON "WithholdingCertificate"("createdById");

-- CreateIndex
CREATE INDEX "CrAllocation_certificateId_idx" ON "CrAllocation"("certificateId");

-- AddForeignKey
ALTER TABLE "CrAllocation" ADD CONSTRAINT "CrAllocation_certificateId_fkey" FOREIGN KEY ("certificateId") REFERENCES "WithholdingCertificate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WithholdingCertificate" ADD CONSTRAINT "WithholdingCertificate_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WithholdingCertificate" ADD CONSTRAINT "WithholdingCertificate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
