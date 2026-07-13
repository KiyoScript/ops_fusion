import { ConflictError, NotFoundError } from "@/lib/errors";
import { type Actor } from "@/lib/authz";
import { assertCan } from "@/lib/ability";
import { PriceRuleType } from "@/generated/prisma/enums";
import type { IActivityLogRepository } from "@/modules/shared/repositories/activity-log-repository";
import type {
  IPriceListRepository,
  RuleCreateData,
} from "../repositories/price-list-repository";
import type { ProductSaveInput } from "../schemas/price-list";

// Quotation Maintenance CRUD — products + their price rules are edited as
// ONE unit (the dialog saves the whole rule set, replace-style, exactly
// like the spreadsheet import), so there is no per-rule endpoint to drift.
export class PriceListService {
  constructor(
    private readonly priceList: IPriceListRepository,
    private readonly activity: IActivityLogRepository
  ) {}

  async saveProduct(
    actor: Actor,
    input: ProductSaveInput
  ): Promise<{ id: string }> {
    assertCan(actor, "maintain", "Maintenance");

    const duplicate = await this.priceList.findProductByName(
      input.name,
      input.id
    );
    if (duplicate) {
      throw new ConflictError(`A product named "${input.name}" already exists.`);
    }

    const rules = buildRules(input);
    const fields = {
      name: input.name,
      category: input.category,
      unit: input.unit,
      basePrice: input.basePrice || firstVariantPrice(rules) || "0",
      description: input.description || null,
    };

    return this.priceList.withTransaction(async (tx) => {
      let id = input.id;
      if (id) {
        await this.priceList.updateProduct(id, fields, tx);
      } else {
        id = (
          await this.priceList.createProduct(
            { ...fields, createdById: actor.id },
            tx
          )
        ).id;
      }
      await this.priceList.replaceRules(id, rules, tx);
      await this.activity.log(
        {
          userId: actor.id,
          entityType: "Product",
          entityId: id,
          action: input.id ? "update" : "create",
          payload: { name: input.name, rules: rules.length },
        },
        tx
      );
      return { id };
    });
  }

  /** Soft removal — quote/JO items that reference it keep working. */
  async archiveProduct(actor: Actor, id: string): Promise<void> {
    assertCan(actor, "maintain", "Maintenance");
    const exists = await this.priceList.findProductById(id);
    if (!exists) throw new NotFoundError("Product not found.");

    await this.priceList.withTransaction(async (tx) => {
      await this.priceList.softDeleteProduct(id, tx);
      await this.activity.log(
        {
          userId: actor.id,
          entityType: "Product",
          entityId: id,
          action: "archive",
          payload: { name: exists.name },
        },
        tx
      );
    });
  }
}

function buildRules(input: ProductSaveInput): RuleCreateData[] {
  return input.rules.map((rule, index) => ({
    type: rule.type === "ADDON" ? PriceRuleType.ADDON : PriceRuleType.VARIANT,
    label: rule.label,
    unitPrice: rule.unitPrice ? parseFloat(rule.unitPrice).toFixed(2) : null,
    minQty: rule.minQty ? Math.max(parseInt(rule.minQty, 10) || 1, 1) : 1,
    minCharge: rule.minCharge ? parseFloat(rule.minCharge).toFixed(2) : null,
    amount: rule.amount ? parseFloat(rule.amount).toFixed(2) : null,
    pct: rule.pct ? parseFloat(rule.pct).toFixed(2) : null,
    notes: rule.notes || null,
    sortOrder: index,
  }));
}

function firstVariantPrice(rules: RuleCreateData[]): string | null {
  return (
    rules.find((r) => r.type === PriceRuleType.VARIANT && r.unitPrice)
      ?.unitPrice ?? null
  );
}
