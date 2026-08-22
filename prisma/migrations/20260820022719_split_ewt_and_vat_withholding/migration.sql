/*
  Warnings:

  - You are about to drop the column `certificateId` on the `CrAllocation` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "WithholdingKind" AS ENUM ('EWT_2307', 'VAT_2306');

-- DropForeignKey
ALTER TABLE "CrAllocation" DROP CONSTRAINT "CrAllocation_certificateId_fkey";

-- DropIndex
DROP INDEX "CrAllocation_certificateId_idx";

-- AlterTable
ALTER TABLE "CrAllocation" DROP COLUMN "certificateId",
ADD COLUMN     "ewtCertificateId" TEXT,
ADD COLUMN     "vatCertificateId" TEXT,
ADD COLUMN     "vatWithheld" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "vatWithholdingRatePct" DECIMAL(5,2),
ADD COLUMN     "withholdsVat" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "WithholdingCertificate" ADD COLUMN     "kind" "WithholdingKind" NOT NULL DEFAULT 'EWT_2307';

-- CreateIndex
CREATE INDEX "CrAllocation_ewtCertificateId_idx" ON "CrAllocation"("ewtCertificateId");

-- CreateIndex
CREATE INDEX "CrAllocation_vatCertificateId_idx" ON "CrAllocation"("vatCertificateId");

-- CreateIndex
CREATE INDEX "WithholdingCertificate_kind_idx" ON "WithholdingCertificate"("kind");

-- AddForeignKey
ALTER TABLE "CrAllocation" ADD CONSTRAINT "CrAllocation_ewtCertificateId_fkey" FOREIGN KEY ("ewtCertificateId") REFERENCES "WithholdingCertificate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrAllocation" ADD CONSTRAINT "CrAllocation_vatCertificateId_fkey" FOREIGN KEY ("vatCertificateId") REFERENCES "WithholdingCertificate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
