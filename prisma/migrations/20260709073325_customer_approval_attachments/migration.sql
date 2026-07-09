-- AlterTable
ALTER TABLE "JobOrder" ADD COLUMN     "customerApprovedAt" TIMESTAMP(3),
ADD COLUMN     "isApprovedByCustomer" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "JobOrderAttachment" (
    "id" TEXT NOT NULL,
    "jobOrderId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobOrderAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobOrderAttachment_jobOrderId_idx" ON "JobOrderAttachment"("jobOrderId");

-- CreateIndex
CREATE INDEX "JobOrderAttachment_uploadedById_idx" ON "JobOrderAttachment"("uploadedById");

-- AddForeignKey
ALTER TABLE "JobOrderAttachment" ADD CONSTRAINT "JobOrderAttachment_jobOrderId_fkey" FOREIGN KEY ("jobOrderId") REFERENCES "JobOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobOrderAttachment" ADD CONSTRAINT "JobOrderAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
