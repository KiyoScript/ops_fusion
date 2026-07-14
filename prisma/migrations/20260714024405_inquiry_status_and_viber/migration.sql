-- CreateEnum
CREATE TYPE "InquiryStatus" AS ENUM ('OPEN', 'QUOTED', 'CLOSED');

-- AlterEnum
ALTER TYPE "InquiryMedium" ADD VALUE 'VIBER';

-- AlterTable
ALTER TABLE "Inquiry" ADD COLUMN     "closedReason" TEXT,
ADD COLUMN     "status" "InquiryStatus" NOT NULL DEFAULT 'OPEN';

-- CreateIndex
CREATE INDEX "Inquiry_status_idx" ON "Inquiry"("status");
