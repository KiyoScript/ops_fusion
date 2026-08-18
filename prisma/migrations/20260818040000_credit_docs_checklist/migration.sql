-- Credit-line document checklist flags on Company (tracking only; not credit terms).
-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "docBir2303" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "docBusinessReg" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "docCreditAppForm" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "docMayorPermit" BOOLEAN NOT NULL DEFAULT false;
