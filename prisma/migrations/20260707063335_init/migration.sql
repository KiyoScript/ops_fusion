-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'MANAGER', 'ENCODER', 'AUDITOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('TYPE_A', 'TYPE_B', 'TYPE_C');

-- CreateEnum
CREATE TYPE "InquiryMedium" AS ENUM ('MESSENGER', 'EMAIL', 'WALK_IN', 'CALL');

-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'SENT', 'APPROVED', 'REJECTED', 'EXPIRED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "ConfirmationType" AS ENUM ('PO', 'SIGNED_QUOTE', 'EMAIL');

-- CreateEnum
CREATE TYPE "JobOrderStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'IN_PROGRESS', 'COMPLETED', 'INVOICED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BookletType" AS ENUM ('SI_VAT', 'SI_NON_VAT', 'JO_SLIP', 'CR', 'DR');

-- CreateEnum
CREATE TYPE "BookletStatus" AS ENUM ('PENDING_APPROVAL', 'ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "SaleType" AS ENUM ('SI_VAT', 'SI_NON_VAT');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CHECK', 'GCASH', 'BANK_TRANSFER', 'QR');

-- CreateEnum
CREATE TYPE "AdvancePaymentStatus" AS ENUM ('UNAPPLIED', 'PARTIALLY_APPLIED', 'FULLY_APPLIED');

-- CreateEnum
CREATE TYPE "DeliveryReceiptStatus" AS ENUM ('ISSUED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AuditEntryStatus" AS ENUM ('REVIEWED', 'FLAGGED');

-- CreateEnum
CREATE TYPE "AuditFlagType" AS ENUM ('DISCREPANCY', 'MISSING', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReconDayStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'FLAGGED', 'CLOSED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "passwordHash" TEXT,
    "role" "Role" NOT NULL DEFAULT 'VIEWER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactNumber" TEXT,
    "company" TEXT,
    "email" TEXT,
    "address" TEXT,
    "tin" TEXT,
    "customerType" "CustomerType" NOT NULL DEFAULT 'TYPE_C',
    "vatRegistered" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'pcs',
    "basePrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inquiry" (
    "id" TEXT NOT NULL,
    "customerId" TEXT,
    "customerName" TEXT NOT NULL,
    "contactNumber" TEXT,
    "medium" "InquiryMedium" NOT NULL,
    "servicesRequested" TEXT NOT NULL,
    "notes" TEXT,
    "quotationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "Inquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quotation" (
    "id" TEXT NOT NULL,
    "quoteNumber" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" "QuotationStatus" NOT NULL DEFAULT 'DRAFT',
    "validUntil" TIMESTAMP(3),
    "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "sentAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,

    CONSTRAINT "Quotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotationItem" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "specs" JSONB,
    "qty" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(12,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "QuotationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobOrder" (
    "id" TEXT NOT NULL,
    "joNumber" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "quotationId" TEXT,
    "status" "JobOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "deadline" TIMESTAMP(3),
    "isLFP" BOOLEAN NOT NULL DEFAULT false,
    "confirmationType" "ConfirmationType",
    "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,

    CONSTRAINT "JobOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobOrderItem" (
    "id" TEXT NOT NULL,
    "jobOrderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "specs" JSONB,
    "qty" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "lineTotal" DECIMAL(12,2) NOT NULL,
    "qtyDelivered" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "JobOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobOrderStatusHistory" (
    "id" TEXT NOT NULL,
    "jobOrderId" TEXT NOT NULL,
    "fromStatus" "JobOrderStatus",
    "toStatus" "JobOrderStatus" NOT NULL,
    "remarks" TEXT,
    "changedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobOrderStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booklet" (
    "id" TEXT NOT NULL,
    "type" "BookletType" NOT NULL,
    "seriesStart" INTEGER NOT NULL,
    "seriesEnd" INTEGER NOT NULL,
    "nextNumber" INTEGER NOT NULL,
    "status" "BookletStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "openedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Booklet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sale" (
    "id" TEXT NOT NULL,
    "documentNo" TEXT NOT NULL,
    "bookletId" TEXT,
    "type" "SaleType" NOT NULL,
    "customerId" TEXT NOT NULL,
    "jobOrderId" TEXT,
    "saleDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "vatAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionReceipt" (
    "id" TEXT NOT NULL,
    "crNumber" TEXT NOT NULL,
    "bookletId" TEXT,
    "customerId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,

    CONSTRAINT "CollectionReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrAllocation" (
    "id" TEXT NOT NULL,
    "crId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "CrAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdvancePayment" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "AdvancePaymentStatus" NOT NULL DEFAULT 'UNAPPLIED',
    "reference" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,

    CONSTRAINT "AdvancePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdvancePaymentApplication" (
    "id" TEXT NOT NULL,
    "advancePaymentId" TEXT NOT NULL,
    "jobOrderId" TEXT,
    "deliveryReceiptId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "appliedById" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdvancePaymentApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryReceipt" (
    "id" TEXT NOT NULL,
    "drNumber" TEXT NOT NULL,
    "bookletId" TEXT,
    "jobOrderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" "DeliveryReceiptStatus" NOT NULL DEFAULT 'ISSUED',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,

    CONSTRAINT "DeliveryReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryReceiptLine" (
    "id" TEXT NOT NULL,
    "deliveryReceiptId" TEXT NOT NULL,
    "jobOrderItemId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,

    CONSTRAINT "DeliveryReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEntry" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "status" "AuditEntryStatus" NOT NULL,
    "flagType" "AuditFlagType",
    "remarks" TEXT,
    "auditorId" TEXT NOT NULL,
    "auditedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationDay" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "ReconDayStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "depositAmount" DECIMAL(12,2),
    "depositDate" TIMESTAMP(3),
    "remarks" TEXT,
    "lockedById" TEXT,
    "lockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReconciliationDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Counter" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Counter_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE INDEX "Customer_name_idx" ON "Customer"("name");

-- CreateIndex
CREATE INDEX "Customer_customerType_idx" ON "Customer"("customerType");

-- CreateIndex
CREATE INDEX "Customer_deletedAt_idx" ON "Customer"("deletedAt");

-- CreateIndex
CREATE INDEX "Customer_createdById_idx" ON "Customer"("createdById");

-- CreateIndex
CREATE INDEX "Product_name_idx" ON "Product"("name");

-- CreateIndex
CREATE INDEX "Product_category_idx" ON "Product"("category");

-- CreateIndex
CREATE INDEX "Product_isActive_idx" ON "Product"("isActive");

-- CreateIndex
CREATE INDEX "Product_deletedAt_idx" ON "Product"("deletedAt");

-- CreateIndex
CREATE INDEX "Product_createdById_idx" ON "Product"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "Inquiry_quotationId_key" ON "Inquiry"("quotationId");

-- CreateIndex
CREATE INDEX "Inquiry_customerId_idx" ON "Inquiry"("customerId");

-- CreateIndex
CREATE INDEX "Inquiry_medium_idx" ON "Inquiry"("medium");

-- CreateIndex
CREATE INDEX "Inquiry_createdAt_idx" ON "Inquiry"("createdAt");

-- CreateIndex
CREATE INDEX "Inquiry_createdById_idx" ON "Inquiry"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "Quotation_quoteNumber_key" ON "Quotation"("quoteNumber");

-- CreateIndex
CREATE INDEX "Quotation_customerId_idx" ON "Quotation"("customerId");

-- CreateIndex
CREATE INDEX "Quotation_status_idx" ON "Quotation"("status");

-- CreateIndex
CREATE INDEX "Quotation_createdAt_idx" ON "Quotation"("createdAt");

-- CreateIndex
CREATE INDEX "Quotation_deletedAt_idx" ON "Quotation"("deletedAt");

-- CreateIndex
CREATE INDEX "Quotation_approvedById_idx" ON "Quotation"("approvedById");

-- CreateIndex
CREATE INDEX "Quotation_createdById_idx" ON "Quotation"("createdById");

-- CreateIndex
CREATE INDEX "QuotationItem_quotationId_idx" ON "QuotationItem"("quotationId");

-- CreateIndex
CREATE INDEX "QuotationItem_productId_idx" ON "QuotationItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "JobOrder_joNumber_key" ON "JobOrder"("joNumber");

-- CreateIndex
CREATE UNIQUE INDEX "JobOrder_quotationId_key" ON "JobOrder"("quotationId");

-- CreateIndex
CREATE INDEX "JobOrder_customerId_idx" ON "JobOrder"("customerId");

-- CreateIndex
CREATE INDEX "JobOrder_status_idx" ON "JobOrder"("status");

-- CreateIndex
CREATE INDEX "JobOrder_deadline_idx" ON "JobOrder"("deadline");

-- CreateIndex
CREATE INDEX "JobOrder_createdAt_idx" ON "JobOrder"("createdAt");

-- CreateIndex
CREATE INDEX "JobOrder_deletedAt_idx" ON "JobOrder"("deletedAt");

-- CreateIndex
CREATE INDEX "JobOrder_approvedById_idx" ON "JobOrder"("approvedById");

-- CreateIndex
CREATE INDEX "JobOrder_createdById_idx" ON "JobOrder"("createdById");

-- CreateIndex
CREATE INDEX "JobOrderItem_jobOrderId_idx" ON "JobOrderItem"("jobOrderId");

-- CreateIndex
CREATE INDEX "JobOrderItem_productId_idx" ON "JobOrderItem"("productId");

-- CreateIndex
CREATE INDEX "JobOrderStatusHistory_jobOrderId_idx" ON "JobOrderStatusHistory"("jobOrderId");

-- CreateIndex
CREATE INDEX "JobOrderStatusHistory_changedById_idx" ON "JobOrderStatusHistory"("changedById");

-- CreateIndex
CREATE INDEX "Booklet_type_status_idx" ON "Booklet"("type", "status");

-- CreateIndex
CREATE INDEX "Booklet_openedById_idx" ON "Booklet"("openedById");

-- CreateIndex
CREATE INDEX "Booklet_approvedById_idx" ON "Booklet"("approvedById");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_jobOrderId_key" ON "Sale"("jobOrderId");

-- CreateIndex
CREATE INDEX "Sale_documentNo_idx" ON "Sale"("documentNo");

-- CreateIndex
CREATE INDEX "Sale_customerId_idx" ON "Sale"("customerId");

-- CreateIndex
CREATE INDEX "Sale_saleDate_idx" ON "Sale"("saleDate");

-- CreateIndex
CREATE INDEX "Sale_type_idx" ON "Sale"("type");

-- CreateIndex
CREATE INDEX "Sale_deletedAt_idx" ON "Sale"("deletedAt");

-- CreateIndex
CREATE INDEX "Sale_bookletId_idx" ON "Sale"("bookletId");

-- CreateIndex
CREATE INDEX "Sale_createdById_idx" ON "Sale"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionReceipt_crNumber_key" ON "CollectionReceipt"("crNumber");

-- CreateIndex
CREATE INDEX "CollectionReceipt_customerId_idx" ON "CollectionReceipt"("customerId");

-- CreateIndex
CREATE INDEX "CollectionReceipt_receivedAt_idx" ON "CollectionReceipt"("receivedAt");

-- CreateIndex
CREATE INDEX "CollectionReceipt_deletedAt_idx" ON "CollectionReceipt"("deletedAt");

-- CreateIndex
CREATE INDEX "CollectionReceipt_bookletId_idx" ON "CollectionReceipt"("bookletId");

-- CreateIndex
CREATE INDEX "CollectionReceipt_createdById_idx" ON "CollectionReceipt"("createdById");

-- CreateIndex
CREATE INDEX "CrAllocation_saleId_idx" ON "CrAllocation"("saleId");

-- CreateIndex
CREATE UNIQUE INDEX "CrAllocation_crId_saleId_key" ON "CrAllocation"("crId", "saleId");

-- CreateIndex
CREATE INDEX "AdvancePayment_customerId_status_idx" ON "AdvancePayment"("customerId", "status");

-- CreateIndex
CREATE INDEX "AdvancePayment_deletedAt_idx" ON "AdvancePayment"("deletedAt");

-- CreateIndex
CREATE INDEX "AdvancePayment_createdById_idx" ON "AdvancePayment"("createdById");

-- CreateIndex
CREATE INDEX "AdvancePaymentApplication_advancePaymentId_idx" ON "AdvancePaymentApplication"("advancePaymentId");

-- CreateIndex
CREATE INDEX "AdvancePaymentApplication_jobOrderId_idx" ON "AdvancePaymentApplication"("jobOrderId");

-- CreateIndex
CREATE INDEX "AdvancePaymentApplication_deliveryReceiptId_idx" ON "AdvancePaymentApplication"("deliveryReceiptId");

-- CreateIndex
CREATE INDEX "AdvancePaymentApplication_appliedById_idx" ON "AdvancePaymentApplication"("appliedById");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryReceipt_drNumber_key" ON "DeliveryReceipt"("drNumber");

-- CreateIndex
CREATE INDEX "DeliveryReceipt_jobOrderId_idx" ON "DeliveryReceipt"("jobOrderId");

-- CreateIndex
CREATE INDEX "DeliveryReceipt_customerId_idx" ON "DeliveryReceipt"("customerId");

-- CreateIndex
CREATE INDEX "DeliveryReceipt_deletedAt_idx" ON "DeliveryReceipt"("deletedAt");

-- CreateIndex
CREATE INDEX "DeliveryReceipt_bookletId_idx" ON "DeliveryReceipt"("bookletId");

-- CreateIndex
CREATE INDEX "DeliveryReceipt_createdById_idx" ON "DeliveryReceipt"("createdById");

-- CreateIndex
CREATE INDEX "DeliveryReceiptLine_deliveryReceiptId_idx" ON "DeliveryReceiptLine"("deliveryReceiptId");

-- CreateIndex
CREATE INDEX "DeliveryReceiptLine_jobOrderItemId_idx" ON "DeliveryReceiptLine"("jobOrderItemId");

-- CreateIndex
CREATE INDEX "AuditEntry_saleId_idx" ON "AuditEntry"("saleId");

-- CreateIndex
CREATE INDEX "AuditEntry_status_idx" ON "AuditEntry"("status");

-- CreateIndex
CREATE INDEX "AuditEntry_auditorId_idx" ON "AuditEntry"("auditorId");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationDay_date_key" ON "ReconciliationDay"("date");

-- CreateIndex
CREATE INDEX "ReconciliationDay_status_idx" ON "ReconciliationDay"("status");

-- CreateIndex
CREATE INDEX "ReconciliationDay_lockedById_idx" ON "ReconciliationDay"("lockedById");

-- CreateIndex
CREATE INDEX "ActivityLog_entityType_entityId_idx" ON "ActivityLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "ActivityLog_userId_idx" ON "ActivityLog"("userId");

-- CreateIndex
CREATE INDEX "ActivityLog_createdAt_idx" ON "ActivityLog"("createdAt");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationItem" ADD CONSTRAINT "QuotationItem_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationItem" ADD CONSTRAINT "QuotationItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobOrder" ADD CONSTRAINT "JobOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobOrder" ADD CONSTRAINT "JobOrder_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobOrder" ADD CONSTRAINT "JobOrder_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobOrder" ADD CONSTRAINT "JobOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobOrderItem" ADD CONSTRAINT "JobOrderItem_jobOrderId_fkey" FOREIGN KEY ("jobOrderId") REFERENCES "JobOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobOrderItem" ADD CONSTRAINT "JobOrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobOrderStatusHistory" ADD CONSTRAINT "JobOrderStatusHistory_jobOrderId_fkey" FOREIGN KEY ("jobOrderId") REFERENCES "JobOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobOrderStatusHistory" ADD CONSTRAINT "JobOrderStatusHistory_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booklet" ADD CONSTRAINT "Booklet_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booklet" ADD CONSTRAINT "Booklet_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_bookletId_fkey" FOREIGN KEY ("bookletId") REFERENCES "Booklet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_jobOrderId_fkey" FOREIGN KEY ("jobOrderId") REFERENCES "JobOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionReceipt" ADD CONSTRAINT "CollectionReceipt_bookletId_fkey" FOREIGN KEY ("bookletId") REFERENCES "Booklet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionReceipt" ADD CONSTRAINT "CollectionReceipt_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionReceipt" ADD CONSTRAINT "CollectionReceipt_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrAllocation" ADD CONSTRAINT "CrAllocation_crId_fkey" FOREIGN KEY ("crId") REFERENCES "CollectionReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrAllocation" ADD CONSTRAINT "CrAllocation_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvancePayment" ADD CONSTRAINT "AdvancePayment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvancePayment" ADD CONSTRAINT "AdvancePayment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvancePaymentApplication" ADD CONSTRAINT "AdvancePaymentApplication_advancePaymentId_fkey" FOREIGN KEY ("advancePaymentId") REFERENCES "AdvancePayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvancePaymentApplication" ADD CONSTRAINT "AdvancePaymentApplication_jobOrderId_fkey" FOREIGN KEY ("jobOrderId") REFERENCES "JobOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvancePaymentApplication" ADD CONSTRAINT "AdvancePaymentApplication_deliveryReceiptId_fkey" FOREIGN KEY ("deliveryReceiptId") REFERENCES "DeliveryReceipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvancePaymentApplication" ADD CONSTRAINT "AdvancePaymentApplication_appliedById_fkey" FOREIGN KEY ("appliedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryReceipt" ADD CONSTRAINT "DeliveryReceipt_bookletId_fkey" FOREIGN KEY ("bookletId") REFERENCES "Booklet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryReceipt" ADD CONSTRAINT "DeliveryReceipt_jobOrderId_fkey" FOREIGN KEY ("jobOrderId") REFERENCES "JobOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryReceipt" ADD CONSTRAINT "DeliveryReceipt_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryReceipt" ADD CONSTRAINT "DeliveryReceipt_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryReceiptLine" ADD CONSTRAINT "DeliveryReceiptLine_deliveryReceiptId_fkey" FOREIGN KEY ("deliveryReceiptId") REFERENCES "DeliveryReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryReceiptLine" ADD CONSTRAINT "DeliveryReceiptLine_jobOrderItemId_fkey" FOREIGN KEY ("jobOrderItemId") REFERENCES "JobOrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEntry" ADD CONSTRAINT "AuditEntry_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEntry" ADD CONSTRAINT "AuditEntry_auditorId_fkey" FOREIGN KEY ("auditorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationDay" ADD CONSTRAINT "ReconciliationDay_lockedById_fkey" FOREIGN KEY ("lockedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
