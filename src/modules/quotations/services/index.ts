// Composition root: services get their repository implementations here, so
// everything else depends only on interfaces.
import { PrismaCustomerRepository } from "@/modules/shared/repositories/customer-repository";
import { PrismaActivityLogRepository } from "@/modules/shared/repositories/activity-log-repository";
import { PrismaJobOrderRepository } from "@/modules/job-orders/repositories/job-order-repository";
import { PrismaQuotationRepository } from "../repositories/quotation-repository";
import { PrismaInquiryRepository } from "../repositories/inquiry-repository";
import { PrismaPriceListRepository } from "../repositories/price-list-repository";
import { QuotationService } from "./quotation-service";
import { InquiryService } from "./inquiry-service";
import { PriceImportService } from "./price-import-service";
import { WorkbookImportService } from "./workbook-import-service";
import { PriceListService } from "./price-list-service";

let quotationService: QuotationService | undefined;
let inquiryService: InquiryService | undefined;
let priceImportService: PriceImportService | undefined;
let workbookImportService: WorkbookImportService | undefined;
let priceListService: PriceListService | undefined;

export function getQuotationService(): QuotationService {
  quotationService ??= new QuotationService(
    new PrismaQuotationRepository(),
    new PrismaCustomerRepository(),
    new PrismaActivityLogRepository(),
    // JO repo powers quote → JO conversion (numbering + creation);
    // inquiry repo links Inquiry → Quotation on create.
    new PrismaJobOrderRepository(),
    new PrismaInquiryRepository()
  );
  return quotationService;
}

export function getInquiryService(): InquiryService {
  inquiryService ??= new InquiryService(
    new PrismaInquiryRepository(),
    new PrismaActivityLogRepository()
  );
  return inquiryService;
}

export function getPriceImportService(): PriceImportService {
  priceImportService ??= new PriceImportService(
    new PrismaPriceListRepository(),
    new PrismaActivityLogRepository()
  );
  return priceImportService;
}

export function getWorkbookImportService(): WorkbookImportService {
  workbookImportService ??= new WorkbookImportService(
    new PrismaPriceListRepository(),
    new PrismaActivityLogRepository()
  );
  return workbookImportService;
}

export function getPriceListService(): PriceListService {
  priceListService ??= new PriceListService(
    new PrismaPriceListRepository(),
    new PrismaActivityLogRepository()
  );
  return priceListService;
}
