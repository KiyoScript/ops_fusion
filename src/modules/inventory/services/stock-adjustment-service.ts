import { format } from "date-fns";
import { NotFoundError, ValidationError } from "@/lib/errors";
import type { Actor } from "@/lib/authz";
import { assertCan } from "@/lib/ability";
import { AdjStatus, LedgerType } from "@/generated/prisma/enums";
import type { IActivityLogRepository } from "@/modules/shared/repositories/activity-log-repository";
import { PrismaActivityLogRepository } from "@/modules/shared/repositories/activity-log-repository";
import type { IMaterialRepository } from "../repositories/material-repository";
import { PrismaMaterialRepository } from "../repositories/material-repository";
import type { IStockRepository } from "../repositories/stock-repository";
import { PrismaStockRepository } from "../repositories/stock-repository";
import type {
  AdjustmentDetailRecord,
  AdjustmentListRecord,
  IStockAdjustmentRepository,
} from "../repositories/stock-adjustment-repository";
import { PrismaStockAdjustmentRepository } from "../repositories/stock-adjustment-repository";
import type {
  AdjustmentDecisionInput,
  AdjustmentDetailDto,
  AdjustmentInput,
  AdjustmentListFilters,
  AdjustmentListPageDto,
  AdjustmentListRowDto,
} from "../schemas/stock";

const BRANCH_CODE = "ORM";
const signed = (n: number): string => n.toFixed(2);

export class StockAdjustmentService {
  constructor(
    private readonly adjustments: IStockAdjustmentRepository,
    private readonly materials: IMaterialRepository,
    private readonly stock: IStockRepository,
    private readonly activity: IActivityLogRepository
  ) {}

  /** Create a PENDING adjustment. It posts NOTHING to the ledger — a separate
   *  explicit approval does that. (Never auto-approved, not even for admins.) */
  async request(actor: Actor, input: AdjustmentInput): Promise<{ id: string }> {
    assertCan(actor, "create", "StockAdjustment");

    const ids = [...new Set(input.lines.map((l) => l.materialId))];
    const materials = await this.materials.listByIds(ids);
    const byId = new Map(materials.map((m) => [m.id, m]));
    if (materials.length !== ids.length) {
      throw new ValidationError("An item on this adjustment no longer exists.");
    }

    const lines = input.lines.map((l) => {
      const m = byId.get(l.materialId)!;
      // Default the movement cost to the item's current unit cost.
      const unitCost = l.unitCost ?? parseFloat(m.unitCost.toString());
      return {
        materialId: l.materialId,
        qtyDelta: l.qtyDelta,
        unitCost,
        reason: l.reason?.trim() || null,
      };
    });

    return this.adjustments.withTransaction(async (tx) => {
      const number = await this.allocateNumber(tx);
      const created = await this.adjustments.create(
        {
          number,
          reason: input.reason,
          note: input.note?.trim() || null,
          requestedById: actor.id,
          lines,
        },
        tx
      );
      await this.activity.log(
        {
          userId: actor.id,
          entityType: "StockAdjustment",
          entityId: created.id,
          action: "request",
          payload: { number, lines: lines.length },
        },
        tx
      );
      return { id: created.id };
    });
  }

  /** Approve a pending adjustment → post ADJUSTMENT ledger rows. Blocks any
   *  line that would drive a material's on-hand below zero. */
  async approve(
    actor: Actor,
    input: AdjustmentDecisionInput
  ): Promise<void> {
    assertCan(actor, "approve", "StockAdjustment");
    const adj = await this.adjustments.findForDecision(input.id);
    if (!adj) throw new NotFoundError("Adjustment not found.");
    if (adj.status !== AdjStatus.PENDING) {
      throw new ValidationError(
        `This adjustment is already ${adj.status.toLowerCase()}.`
      );
    }

    // Guard: no line may push on-hand negative. Sum deltas per material first
    // (a document may touch the same item on more than one line).
    const netByMaterial = new Map<string, number>();
    for (const l of adj.lines) {
      netByMaterial.set(
        l.materialId,
        (netByMaterial.get(l.materialId) ?? 0) + l.qtyDelta
      );
    }
    for (const [materialId, net] of netByMaterial) {
      if (net >= 0) continue;
      const onHand = await this.stock.onHandOne(materialId);
      if (onHand + net < 0) {
        const m = (await this.materials.findById(materialId))?.code ?? "Item";
        throw new ValidationError(
          `${m}: adjustment would leave ${onHand + net} pcs (only ${onHand} on hand).`
        );
      }
    }

    await this.adjustments.withTransaction(async (tx) => {
      await this.adjustments.setDecision(
        input.id,
        {
          status: AdjStatus.APPROVED,
          decidedById: actor.id,
          decisionNote: input.note?.trim() || null,
        },
        tx
      );
      for (const l of adj.lines) {
        await this.stock.postEntry(
          {
            materialId: l.materialId,
            type: LedgerType.ADJUSTMENT,
            qtyIn: l.qtyDelta > 0 ? l.qtyDelta : 0,
            qtyOut: l.qtyDelta < 0 ? -l.qtyDelta : 0,
            unitCost: l.unitCost.toString(),
            refType: "StockAdjustment",
            refId: input.id,
            note: "Stock adjustment",
            createdById: actor.id,
          },
          tx
        );
      }
      await this.activity.log(
        {
          userId: actor.id,
          entityType: "StockAdjustment",
          entityId: input.id,
          action: "approve",
          payload: { lines: adj.lines.length },
        },
        tx
      );
    });
  }

  /** Reject a pending adjustment. Posts nothing to the ledger. */
  async reject(actor: Actor, input: AdjustmentDecisionInput): Promise<void> {
    assertCan(actor, "approve", "StockAdjustment");
    const adj = await this.adjustments.findForDecision(input.id);
    if (!adj) throw new NotFoundError("Adjustment not found.");
    if (adj.status !== AdjStatus.PENDING) {
      throw new ValidationError(
        `This adjustment is already ${adj.status.toLowerCase()}.`
      );
    }
    await this.adjustments.withTransaction(async (tx) => {
      await this.adjustments.setDecision(
        input.id,
        {
          status: AdjStatus.REJECTED,
          decidedById: actor.id,
          decisionNote: input.note?.trim() || null,
        },
        tx
      );
      await this.activity.log(
        {
          userId: actor.id,
          entityType: "StockAdjustment",
          entityId: input.id,
          action: "reject",
          payload: {},
        },
        tx
      );
    });
  }

  async list(
    _actor: Actor,
    filters: AdjustmentListFilters
  ): Promise<AdjustmentListPageDto> {
    const { rows, nextCursor } = await this.adjustments.listPage(filters);
    return { rows: rows.map(mapListRow), nextCursor };
  }

  async get(_actor: Actor, id: string): Promise<AdjustmentDetailDto> {
    const adj = await this.adjustments.findDetail(id);
    if (!adj) throw new NotFoundError("Adjustment not found.");
    return mapDetail(adj);
  }

  private async allocateNumber(
    tx: Parameters<IStockRepository["nextCounter"]>[1]
  ): Promise<string> {
    const prefix = `ADJ-${BRANCH_CODE}-${format(new Date(), "yyMM")}`;
    for (let i = 0; i < 500; i++) {
      const seq = await this.stock.nextCounter(`adj:${prefix}`, tx);
      const candidate = `${prefix}-${String(seq).padStart(5, "0")}`;
      if (!(await this.adjustments.numberExists(candidate, tx))) return candidate;
    }
    throw new ValidationError("Could not allocate an adjustment number.");
  }
}

// ——— record → DTO ———

function mapListRow(r: AdjustmentListRecord): AdjustmentListRowDto {
  return {
    id: r.id,
    number: r.number,
    reason: r.reason,
    status: r.status,
    lineCount: r.lines.length,
    netQty: r.lines.reduce((s, l) => s + l.qtyDelta, 0),
    requestedByName: r.requestedBy.name,
    requestedAt: r.requestedAt.toISOString(),
    decidedByName: r.decidedBy?.name ?? null,
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
  };
}

function mapDetail(r: AdjustmentDetailRecord): AdjustmentDetailDto {
  return {
    id: r.id,
    number: r.number,
    reason: r.reason,
    status: r.status,
    note: r.note,
    decisionNote: r.decisionNote,
    lineCount: r.lines.length,
    netQty: r.lines.reduce((s, l) => s + l.qtyDelta, 0),
    requestedByName: r.requestedBy.name,
    requestedAt: r.requestedAt.toISOString(),
    decidedByName: r.decidedBy?.name ?? null,
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    lines: r.lines.map((l) => {
      const unitCost = parseFloat(l.unitCost.toString());
      return {
        id: l.id,
        materialId: l.materialId,
        code: l.material.code,
        name: l.material.name,
        unit: l.material.unit,
        qtyDelta: l.qtyDelta,
        unitCost: l.unitCost.toString(),
        lineValue: signed(l.qtyDelta * unitCost),
        reason: l.reason,
      };
    }),
  };
}

let instance: StockAdjustmentService | undefined;

export function getStockAdjustmentService(): StockAdjustmentService {
  instance ??= new StockAdjustmentService(
    new PrismaStockAdjustmentRepository(),
    new PrismaMaterialRepository(),
    new PrismaStockRepository(),
    new PrismaActivityLogRepository()
  );
  return instance;
}
