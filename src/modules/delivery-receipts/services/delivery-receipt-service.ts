import { format } from "date-fns";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import type { Actor } from "@/lib/authz";
import { assertCan } from "@/lib/ability";
import type { IActivityLogRepository } from "@/modules/shared/repositories/activity-log-repository";
import { PrismaActivityLogRepository } from "@/modules/shared/repositories/activity-log-repository";
import type {
  DrDetailRecord,
  DrListRecord,
  IDeliveryReceiptRepository,
} from "../repositories/delivery-receipt-repository";
import { PrismaDeliveryReceiptRepository } from "../repositories/delivery-receipt-repository";
import type {
  DeliverableJoDto,
  DrDetailDto,
  DrListFilters,
  DrListPageDto,
  DrListRowDto,
  IssueDrInput,
} from "../schemas/delivery-receipt";

const money = (n: number): string => n.toFixed(2);
const toIso = (d: Date | null): string | null => (d ? d.toISOString() : null);

// ══════════════════════════════════════════════════════════════════════════
// TODO(SALES integration) — deferred until the Sales module lands:
//   • Advance-payment application: spec 3.2 says if the JO has an advance
//     payment on file, DR issuance shows a modal to apply it and adjust the
//     DR amount. AdvancePayment + AdvancePaymentApplication models exist; wire
//     them here once Sales creates advance payments.
//   • "Ready for delivery" gating: detect downpayment / payment status from
//     Sales before allowing issuance, and expose the remaining DR balance.
//   • Booklet numbering: DR numbers currently auto-generate (DR-yyyy-####).
//     Switch to the shared Booklet series (approval-on-opening) when Sales
//     owns the Booklet model.
// ══════════════════════════════════════════════════════════════════════════

export class DeliveryReceiptService {
  constructor(
    private readonly drs: IDeliveryReceiptRepository,
    private readonly activity: IActivityLogRepository
  ) {}

  /** Completed JO line items with quantity still to deliver, grouped by JO
   *  (spec 3.2 — filter by customer/JO handled at the query/UI level). */
  async listDeliverable(
    _actor: Actor,
    opts: { jobOrderId?: string; q?: string } = {}
  ): Promise<DeliverableJoDto[]> {
    const items = await this.drs.listDeliverableItems(opts);
    const byJo = new Map<string, DeliverableJoDto>();

    for (const item of items) {
      const remaining = item.qty - item.qtyDelivered;
      if (remaining <= 0) continue; // fully delivered already
      const jo = item.jobOrder;
      let group = byJo.get(jo.id);
      if (!group) {
        group = {
          jobOrderId: jo.id,
          joNumber: jo.joNumber,
          customerId: jo.customer.id,
          customerName: jo.customer.name,
          completedAt: toIso(jo.completedAt),
          items: [],
        };
        byJo.set(jo.id, group);
      }
      group.items.push({
        id: item.id,
        lineItemId: item.lineItemId ?? jo.joNumber,
        description: item.description,
        qty: item.qty,
        qtyDelivered: item.qtyDelivered,
        remaining,
        unitPrice: item.unitPrice.toString(),
        lineTotal: item.lineTotal.toString(),
      });
    }

    return [...byJo.values()].filter((g) => g.items.length > 0);
  }

  /** Issue a DR for chosen line items with partial quantities (spec 3.2). */
  async issue(actor: Actor, input: IssueDrInput): Promise<{ id: string }> {
    assertCan(actor, "issue", "DeliveryReceipt");

    // Current deliverable state for this JO (source of truth for remaining qty).
    const deliverable = await this.drs.listDeliverableItems({
      jobOrderId: input.jobOrderId,
    });
    if (deliverable.length === 0) {
      throw new NotFoundError("No deliverable items for this job order.");
    }
    const byId = new Map(deliverable.map((i) => [i.id, i]));
    const customerId = deliverable[0]!.jobOrder.customer.id;

    // Validate each requested line against the remaining quantity.
    const toDeliver: { jobOrderItemId: string; qty: number }[] = [];
    for (const line of input.lines) {
      const qty = parseInt(line.qty, 10);
      if (qty <= 0) continue; // skipped line
      const item = byId.get(line.jobOrderItemId);
      if (!item) {
        throw new ValidationError("An item is not deliverable for this JO.");
      }
      const remaining = item.qty - item.qtyDelivered;
      if (qty > remaining) {
        throw new ValidationError(
          `${item.lineItemId ?? "Item"}: only ${remaining} left to deliver (requested ${qty}).`
        );
      }
      toDeliver.push({ jobOrderItemId: item.id, qty });
    }
    if (toDeliver.length === 0) {
      throw new ValidationError("Enter a quantity to deliver on at least one line.");
    }

    const manualNumber = input.drNumber?.trim();
    if (manualNumber && (await this.drs.drNumberExists(manualNumber))) {
      throw new ConflictError(`DR Number "${manualNumber}" already exists.`);
    }

    return this.drs.withTransaction(async (tx) => {
      const drNumber = manualNumber || (await this.generateDrNumber(tx));
      const created = await this.drs.createDr(
        {
          drNumber,
          jobOrderId: input.jobOrderId,
          customerId,
          notes: input.notes || null,
          createdById: actor.id,
          lines: toDeliver,
        },
        tx
      );
      // Maintain qtyDelivered on each JO item (legacy partial-delivery).
      for (const line of toDeliver) {
        await this.drs.incrementDelivered(line.jobOrderItemId, line.qty, tx);
      }
      await this.activity.log(
        {
          userId: actor.id,
          entityType: "DeliveryReceipt",
          entityId: created.id,
          action: "issue",
          payload: {
            drNumber,
            joNumber: deliverable[0]!.jobOrder.joNumber,
            lines: toDeliver.length,
          },
        },
        tx
      );
      return { id: created.id };
    });
  }

  async list(_actor: Actor, filters: DrListFilters): Promise<DrListPageDto> {
    const { rows, nextCursor } = await this.drs.listPage(filters);
    return { rows: rows.map(mapListRow), nextCursor };
  }

  async get(_actor: Actor, id: string): Promise<DrDetailDto> {
    const dr = await this.drs.findDetail(id);
    if (!dr) throw new NotFoundError("Delivery receipt not found.");
    return mapDetail(dr);
  }

  /** Cancel a DR and return its delivered quantities to the JO items. */
  async cancel(actor: Actor, id: string): Promise<void> {
    assertCan(actor, "update", "DeliveryReceipt");
    const dr = await this.drs.getLinesForCancel(id);
    if (!dr) throw new NotFoundError("Delivery receipt not found.");
    if (dr.status === "CANCELLED") {
      throw new ValidationError("This DR is already cancelled.");
    }
    await this.drs.withTransaction(async (tx) => {
      await this.drs.setCancelled(id, tx);
      for (const line of dr.lines) {
        await this.drs.incrementDelivered(line.jobOrderItemId, -line.qty, tx);
      }
      await this.activity.log(
        {
          userId: actor.id,
          entityType: "DeliveryReceipt",
          entityId: id,
          action: "cancel",
          payload: {},
        },
        tx
      );
    });
  }

  private async generateDrNumber(
    tx: Parameters<IDeliveryReceiptRepository["nextCounter"]>[1]
  ): Promise<string> {
    const prefix = `DR-${format(new Date(), "yyyy")}`;
    for (let i = 0; i < 500; i++) {
      const seq = await this.drs.nextCounter(`dr:${prefix}`, tx);
      const candidate = `${prefix}-${String(seq).padStart(4, "0")}`;
      if (!(await this.drs.drNumberExists(candidate, tx))) return candidate;
    }
    throw new ValidationError("Could not allocate a DR number.");
  }
}

// ——— record → DTO ———

function lineAmount(record: DrListRecord | DrDetailRecord): number {
  return record.lines.reduce(
    (sum, l) => sum + l.qty * parseFloat(l.jobOrderItem.unitPrice.toString()),
    0
  );
}

function mapListRow(record: DrListRecord): DrListRowDto {
  return {
    id: record.id,
    drNumber: record.drNumber,
    joNumber: record.jobOrder.joNumber,
    customerName: record.customer.name,
    status: record.status,
    issuedAt: record.issuedAt.toISOString(),
    lineCount: record.lines.length,
    totalQty: record.lines.reduce((s, l) => s + l.qty, 0),
    amount: money(lineAmount(record)),
  };
}

function mapDetail(record: DrDetailRecord): DrDetailDto {
  return {
    id: record.id,
    drNumber: record.drNumber,
    status: record.status,
    issuedAt: record.issuedAt.toISOString(),
    notes: record.notes,
    createdByName: record.createdBy.name,
    jobOrder: record.jobOrder,
    customer: {
      id: record.customer.id,
      name: record.customer.name,
      address: record.customer.address,
      tin: record.customer.tin,
      company: record.customer.company,
    },
    amount: money(lineAmount(record)),
    lines: record.lines.map((l) => ({
      id: l.id,
      description: l.jobOrderItem.description,
      lineItemId: l.jobOrderItem.lineItemId ?? "",
      qty: l.qty,
      unitPrice: l.jobOrderItem.unitPrice.toString(),
      lineTotal: money(
        l.qty * parseFloat(l.jobOrderItem.unitPrice.toString())
      ),
    })),
  };
}

let instance: DeliveryReceiptService | undefined;

export function getDeliveryReceiptService(): DeliveryReceiptService {
  instance ??= new DeliveryReceiptService(
    new PrismaDeliveryReceiptRepository(),
    new PrismaActivityLogRepository()
  );
  return instance;
}
