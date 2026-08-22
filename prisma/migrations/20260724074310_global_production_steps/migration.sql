-- CreateTable
CREATE TABLE "GlobalProductionStep" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rankFromEnd" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlobalProductionStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GlobalProductionStep_isActive_idx" ON "GlobalProductionStep"("isActive");
