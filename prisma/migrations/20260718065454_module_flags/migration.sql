-- CreateTable
CREATE TABLE "ModuleFlag" (
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModuleFlag_pkey" PRIMARY KEY ("key")
);
