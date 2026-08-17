-- CreateEnum
CREATE TYPE "NewspaperRowKind" AS ENUM ('FULL_ISSUE', 'LOOSE_PAGES');

-- CreateTable
CREATE TABLE "NewspaperPublication" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "pricePerPlate" DECIMAL(12,2),
    "laborPerPlate" DECIMAL(12,2),
    "paperRate" DECIMAL(12,4),
    "runningRate" DECIMAL(12,2),
    "marginPct" DECIMAL(5,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "NewspaperPublication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewspaperPriceRow" (
    "id" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "kind" "NewspaperRowKind" NOT NULL DEFAULT 'FULL_ISSUE',
    "totalPages" INTEGER,
    "colorPages" INTEGER NOT NULL DEFAULT 0,
    "bwPages" INTEGER NOT NULL DEFAULT 0,
    "copies" INTEGER NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "priceCode" TEXT,
    "source" TEXT NOT NULL DEFAULT 'TABLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "NewspaperPriceRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewspaperFormulaParams" (
    "id" TEXT NOT NULL,
    "pricePerPlate" DECIMAL(12,2) NOT NULL DEFAULT 400,
    "laborPerPlate" DECIMAL(12,2) NOT NULL DEFAULT 150,
    "paperRate" DECIMAL(12,4) NOT NULL DEFAULT 0.70,
    "runningRate" DECIMAL(12,2) NOT NULL DEFAULT 425,
    "marginPct" DECIMAL(5,4) NOT NULL DEFAULT 0.50,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NewspaperFormulaParams_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NewspaperPublication_name_key" ON "NewspaperPublication"("name");

-- CreateIndex
CREATE INDEX "NewspaperPublication_name_idx" ON "NewspaperPublication"("name");

-- CreateIndex
CREATE INDEX "NewspaperPriceRow_publicationId_kind_totalPages_colorPages__idx" ON "NewspaperPriceRow"("publicationId", "kind", "totalPages", "colorPages", "bwPages", "copies");

-- AddForeignKey
ALTER TABLE "NewspaperPriceRow" ADD CONSTRAINT "NewspaperPriceRow_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "NewspaperPublication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
