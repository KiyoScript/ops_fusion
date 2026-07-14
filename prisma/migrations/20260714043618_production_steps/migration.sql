-- CreateTable
CREATE TABLE "JobOrderItemStep" (
    "id" TEXT NOT NULL,
    "jobOrderItemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "doneAt" TIMESTAMP(3),
    "doneById" TEXT,

    CONSTRAINT "JobOrderItemStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionStep" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobOrderItemStep_jobOrderItemId_idx" ON "JobOrderItemStep"("jobOrderItemId");

-- CreateIndex
CREATE INDEX "ProductionStep_productId_isActive_idx" ON "ProductionStep"("productId", "isActive");

-- AddForeignKey
ALTER TABLE "JobOrderItemStep" ADD CONSTRAINT "JobOrderItemStep_jobOrderItemId_fkey" FOREIGN KEY ("jobOrderItemId") REFERENCES "JobOrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobOrderItemStep" ADD CONSTRAINT "JobOrderItemStep_doneById_fkey" FOREIGN KEY ("doneById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionStep" ADD CONSTRAINT "ProductionStep_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
