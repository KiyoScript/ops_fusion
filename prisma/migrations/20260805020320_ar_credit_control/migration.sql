-- AlterTable
ALTER TABLE "CollectionReceipt" ADD COLUMN     "documentIssued" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "crNumber" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "creditLimit" DECIMAL(12,2),
ADD COLUMN     "creditTermDays" INTEGER;

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "dueDate" TIMESTAMP(3),
ADD COLUMN     "settledAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Sale_customerId_type_dueDate_idx" ON "Sale"("customerId", "type", "dueDate");
