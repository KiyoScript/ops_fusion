-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'PARTIAL', 'PAID');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BookletStatus" ADD VALUE 'UNOPENED';
ALTER TYPE "BookletStatus" ADD VALUE 'REJECTED';
ALTER TYPE "BookletStatus" ADD VALUE 'CONSUMED';

-- AlterEnum
ALTER TYPE "SaleType" ADD VALUE 'JO_SLIP';

-- DropForeignKey
ALTER TABLE "AuditEntry" DROP CONSTRAINT "AuditEntry_saleId_fkey";

-- DropIndex
DROP INDEX "Sale_documentNo_idx";

-- DropIndex
DROP INDEX "Sale_jobOrderId_key";

-- AlterTable
ALTER TABLE "AuditEntry" ADD COLUMN     "collectionReceiptId" TEXT,
ALTER COLUMN "saleId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Booklet" ADD COLUMN     "gapExempt" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "label" TEXT,
ADD COLUMN     "prefix" TEXT NOT NULL,
ADD COLUMN     "rejectionNote" TEXT;

-- AlterTable
ALTER TABLE "CollectionReceipt" ADD COLUMN     "billedToAddress" TEXT,
ADD COLUMN     "billedToName" TEXT,
ADD COLUMN     "billedToTin" TEXT,
ADD COLUMN     "cashTendered" DECIMAL(12,2),
ADD COLUMN     "changeGiven" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "jobOrderId" TEXT,
ADD COLUMN     "methodDetail" TEXT;

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "amountPaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "billedToAddress" TEXT,
ADD COLUMN     "billedToName" TEXT,
ADD COLUMN     "billedToTin" TEXT,
ADD COLUMN     "cashTendered" DECIMAL(12,2),
ADD COLUMN     "changeGiven" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "methodDetail" TEXT,
ADD COLUMN     "paymentMethod" "PaymentMethod",
ADD COLUMN     "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PAID',
ADD COLUMN     "vatableSales" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "AuditEntry_collectionReceiptId_idx" ON "AuditEntry"("collectionReceiptId");

-- CreateIndex
CREATE INDEX "CollectionReceipt_jobOrderId_idx" ON "CollectionReceipt"("jobOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_documentNo_key" ON "Sale"("documentNo");

-- CreateIndex
CREATE INDEX "Sale_jobOrderId_idx" ON "Sale"("jobOrderId");

-- AddForeignKey
ALTER TABLE "AuditEntry" ADD CONSTRAINT "AuditEntry_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEntry" ADD CONSTRAINT "AuditEntry_collectionReceiptId_fkey" FOREIGN KEY ("collectionReceiptId") REFERENCES "CollectionReceipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionReceipt" ADD CONSTRAINT "CollectionReceipt_jobOrderId_fkey" FOREIGN KEY ("jobOrderId") REFERENCES "JobOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ════════════════════════════════════════════════════════════════════════
-- Integrity constraints Prisma's schema language cannot express.
-- These make a bad receipt number impossible at the DATABASE level, not
-- merely unlikely at the application level.
-- ════════════════════════════════════════════════════════════════════════

-- 1. At most ONE ACTIVE booklet per document type.
--    "The next number" must be unambiguous when a cashier hits Receive Payment.
CREATE UNIQUE INDEX "Booklet_one_active_per_type"
  ON "Booklet" ("type")
  WHERE "status" = 'ACTIVE';

-- 2. A booklet's range must be sane, and nextNumber must sit inside it.
--    nextNumber = seriesEnd + 1 is the legal "exhausted" state.
ALTER TABLE "Booklet" ADD CONSTRAINT "Booklet_range_valid"
  CHECK ("seriesEnd" >= "seriesStart");
ALTER TABLE "Booklet" ADD CONSTRAINT "Booklet_next_within_range"
  CHECK ("nextNumber" >= "seriesStart" AND "nextNumber" <= "seriesEnd" + 1);

-- 3. Two booklets of the same type may never claim overlapping number ranges.
--    Without this, two booklets could both hand out IN-0578. btree_gist ships
--    with every standard PostgreSQL distribution.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "Booklet" ADD CONSTRAINT "Booklet_no_overlapping_ranges"
  EXCLUDE USING gist (
    "type" WITH =,
    int4range("seriesStart", "seriesEnd", '[]') WITH &&
  );

-- 4. An audit entry verifies EXACTLY ONE document — a Sale or a Collection
--    Receipt, never both, never neither. No dangling auditor sign-offs.
ALTER TABLE "AuditEntry" ADD CONSTRAINT "AuditEntry_one_target"
  CHECK (num_nonnulls("saleId", "collectionReceiptId") = 1);
