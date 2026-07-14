import { ValidationError } from "@/lib/errors";
import { type Actor } from "@/lib/authz";
import { assertCan } from "@/lib/ability";
import { PriceRuleType } from "@/generated/prisma/enums";
import type { IActivityLogRepository } from "@/modules/shared/repositories/activity-log-repository";
import type { IPriceListRepository } from "../repositories/price-list-repository";
import { SHEET_PARSERS } from "./workbook-parsers";

// Full-workbook import — one upload of the legacy "Online Product specs"
// .xlsx loads EVERY product tab at once, each read by its own parser
// (workbook-parsers.ts). Rules are replaced per product, so re-imports are
// safe and the spreadsheet stays the source of truth.

export type WorkbookImportSummaryDto = {
  sheetsMatched: number;
  productsCreated: number;
  productsUpdated: number;
  rulesCreated: number;
  perSheet: { sheet: string; products: number; rules: number }[];
  skipped: string[];
};

export class WorkbookImportService {
  constructor(
    private readonly priceList: IPriceListRepository,
    private readonly activity: IActivityLogRepository
  ) {}

  async import(
    actor: Actor,
    sheets: { name: string; rows: string[][] }[]
  ): Promise<WorkbookImportSummaryDto> {
    assertCan(actor, "maintain", "Maintenance");

    const perSheet: WorkbookImportSummaryDto["perSheet"] = [];
    const skipped: string[] = [];
    let productsCreated = 0;
    let productsUpdated = 0;
    let rulesCreated = 0;

    await this.priceList.withTransaction(async (tx) => {
      for (const sheet of sheets) {
        const parser = SHEET_PARSERS[sheet.name.toLowerCase()];
        if (!parser) {
          skipped.push(sheet.name);
          continue;
        }
        let sheetProducts = 0;
        let sheetRules = 0;
        const parsed = parser(sheet.rows);
        for (const product of parsed) {
          if (product.rules.length === 0) continue;
          const basePrice =
            product.rules.find((r) => r.type === PriceRuleType.VARIANT)
              ?.unitPrice ?? "0";
          const ref = await this.priceList.findOrCreateProduct(
            {
              name: product.name,
              category: product.category,
              unit: product.unit,
              basePrice,
              createdById: actor.id,
            },
            tx
          );
          await this.priceList.replaceRules(ref.id, product.rules, tx);
          if (ref.created) productsCreated++;
          else productsUpdated++;
          sheetProducts++;
          sheetRules += product.rules.length;
          rulesCreated += product.rules.length;
        }
        if (sheetProducts > 0) {
          perSheet.push({
            sheet: sheet.name,
            products: sheetProducts,
            rules: sheetRules,
          });
        } else {
          skipped.push(sheet.name);
        }
      }

      if (perSheet.length === 0) {
        throw new ValidationError(
          "No known product tabs found — is this the price workbook?"
        );
      }

      await this.activity.log(
        {
          userId: actor.id,
          entityType: "Product",
          entityId: "workbook-import",
          action: "import",
          payload: {
            sheets: perSheet.length,
            productsCreated,
            productsUpdated,
            rulesCreated,
          },
        },
        tx
      );
    });

    return {
      sheetsMatched: perSheet.length,
      productsCreated,
      productsUpdated,
      rulesCreated,
      perSheet,
      skipped,
    };
  }
}
