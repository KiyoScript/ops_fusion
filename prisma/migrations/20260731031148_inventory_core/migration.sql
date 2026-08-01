-- CreateEnum
CREATE TYPE "SupplierStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "MaterialStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "LedgerType" AS ENUM ('OPENING', 'RECEIPT', 'RELEASE', 'ADJUSTMENT', 'COUNT');

-- CreateEnum
CREATE TYPE "AdjStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CountStatus" AS ENUM ('DRAFT', 'COMPLETED', 'APPROVED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "contactPerson" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "status" "SupplierStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Material" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "location" TEXT,
    "area" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'pc',
    "packSize" INTEGER NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(12,4) NOT NULL,
    "unitPrice" DECIMAL(12,2),
    "reorderLevel" INTEGER NOT NULL DEFAULT 0,
    "status" "MaterialStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "supplierId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,

    CONSTRAINT "Material_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLedgerEntry" (
    "id" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "type" "LedgerType" NOT NULL,
    "qtyIn" INTEGER NOT NULL DEFAULT 0,
    "qtyOut" INTEGER NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(12,4) NOT NULL,
    "totalValue" DECIMAL(14,2) NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "note" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "StockLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockAdjustment" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "AdjStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "StockAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockAdjustmentLine" (
    "id" TEXT NOT NULL,
    "adjustmentId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "qtyDelta" INTEGER NOT NULL,
    "unitCost" DECIMAL(12,4) NOT NULL,
    "reason" TEXT,

    CONSTRAINT "StockAdjustmentLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CycleCount" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "CountStatus" NOT NULL DEFAULT 'DRAFT',
    "location" TEXT,
    "note" TEXT,
    "countedById" TEXT NOT NULL,
    "countedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CycleCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CycleCountLine" (
    "id" TEXT NOT NULL,
    "cycleCountId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "systemQty" INTEGER NOT NULL,
    "countedQty" INTEGER NOT NULL,
    "unitCost" DECIMAL(12,4) NOT NULL,
    "note" TEXT,

    CONSTRAINT "CycleCountLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_code_key" ON "Supplier"("code");

-- CreateIndex
CREATE INDEX "Supplier_name_idx" ON "Supplier"("name");

-- CreateIndex
CREATE INDEX "Supplier_status_idx" ON "Supplier"("status");

-- CreateIndex
CREATE INDEX "Supplier_deletedAt_idx" ON "Supplier"("deletedAt");

-- CreateIndex
CREATE INDEX "Supplier_createdById_idx" ON "Supplier"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "Material_code_key" ON "Material"("code");

-- CreateIndex
CREATE INDEX "Material_code_idx" ON "Material"("code");

-- CreateIndex
CREATE INDEX "Material_category_idx" ON "Material"("category");

-- CreateIndex
CREATE INDEX "Material_status_idx" ON "Material"("status");

-- CreateIndex
CREATE INDEX "Material_supplierId_idx" ON "Material"("supplierId");

-- CreateIndex
CREATE INDEX "Material_deletedAt_idx" ON "Material"("deletedAt");

-- CreateIndex
CREATE INDEX "Material_createdById_idx" ON "Material"("createdById");

-- CreateIndex
CREATE INDEX "StockLedgerEntry_materialId_idx" ON "StockLedgerEntry"("materialId");

-- CreateIndex
CREATE INDEX "StockLedgerEntry_type_idx" ON "StockLedgerEntry"("type");

-- CreateIndex
CREATE INDEX "StockLedgerEntry_refType_refId_idx" ON "StockLedgerEntry"("refType", "refId");

-- CreateIndex
CREATE INDEX "StockLedgerEntry_occurredAt_idx" ON "StockLedgerEntry"("occurredAt");

-- CreateIndex
CREATE INDEX "StockLedgerEntry_createdById_idx" ON "StockLedgerEntry"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "StockAdjustment_number_key" ON "StockAdjustment"("number");

-- CreateIndex
CREATE INDEX "StockAdjustment_status_idx" ON "StockAdjustment"("status");

-- CreateIndex
CREATE INDEX "StockAdjustment_number_idx" ON "StockAdjustment"("number");

-- CreateIndex
CREATE INDEX "StockAdjustment_requestedById_idx" ON "StockAdjustment"("requestedById");

-- CreateIndex
CREATE INDEX "StockAdjustment_deletedAt_idx" ON "StockAdjustment"("deletedAt");

-- CreateIndex
CREATE INDEX "StockAdjustmentLine_adjustmentId_idx" ON "StockAdjustmentLine"("adjustmentId");

-- CreateIndex
CREATE INDEX "StockAdjustmentLine_materialId_idx" ON "StockAdjustmentLine"("materialId");

-- CreateIndex
CREATE UNIQUE INDEX "CycleCount_number_key" ON "CycleCount"("number");

-- CreateIndex
CREATE INDEX "CycleCount_status_idx" ON "CycleCount"("status");

-- CreateIndex
CREATE INDEX "CycleCount_number_idx" ON "CycleCount"("number");

-- CreateIndex
CREATE INDEX "CycleCount_countedById_idx" ON "CycleCount"("countedById");

-- CreateIndex
CREATE INDEX "CycleCount_deletedAt_idx" ON "CycleCount"("deletedAt");

-- CreateIndex
CREATE INDEX "CycleCountLine_cycleCountId_idx" ON "CycleCountLine"("cycleCountId");

-- CreateIndex
CREATE INDEX "CycleCountLine_materialId_idx" ON "CycleCountLine"("materialId");

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Material" ADD CONSTRAINT "Material_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Material" ADD CONSTRAINT "Material_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLedgerEntry" ADD CONSTRAINT "StockLedgerEntry_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLedgerEntry" ADD CONSTRAINT "StockLedgerEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustmentLine" ADD CONSTRAINT "StockAdjustmentLine_adjustmentId_fkey" FOREIGN KEY ("adjustmentId") REFERENCES "StockAdjustment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustmentLine" ADD CONSTRAINT "StockAdjustmentLine_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CycleCount" ADD CONSTRAINT "CycleCount_countedById_fkey" FOREIGN KEY ("countedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CycleCount" ADD CONSTRAINT "CycleCount_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CycleCountLine" ADD CONSTRAINT "CycleCountLine_cycleCountId_fkey" FOREIGN KEY ("cycleCountId") REFERENCES "CycleCount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CycleCountLine" ADD CONSTRAINT "CycleCountLine_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
