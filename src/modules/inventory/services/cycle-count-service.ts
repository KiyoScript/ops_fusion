import { format } from "date-fns";
import { NotFoundError, ValidationError } from "@/lib/errors";
import type { Actor } from "@/lib/authz";
import { assertCan } from "@/lib/ability";
import { CountStatus, LedgerType } from "@/generated/prisma/enums";
import type { IActivityLogRepository } from "@/modules/shared/repositories/activity-log-repository";
import { PrismaActivityLogRepository } from "@/modules/shared/repositories/activity-log-repository";
import type { IMaterialRepository } from "../repositories/material-repository";
import { PrismaMaterialRepository } from "../repositories/material-repository";
import type { IStockRepository } from "../repositories/stock-repository";
import { PrismaStockRepository } from "../repositories/stock-repository";
import type {
  CountLineData,
  CycleCountDetailRecord,
  CycleCountListRecord,
  ICycleCountRepository,
} from "../repositories/cycle-count-repository";
import { PrismaCycleCountRepository } from "../repositories/cycle-count-repository";
import type {
  CycleCountDecisionInput,
  CycleCountDetailDto,
  CycleCountInput,
  CycleCountListFilters,
  CycleCountListPageDto,
  CycleCountListRowDto,
  CycleCountUpdateInput,
} from "../schemas/stock";

const BRANCH_CODE = "ORM";
const signed = (n: number): string => n.toFixed(2);

export class CycleCountService {
  constructor(
    private readonly counts: ICycleCountRepository,
    private readonly materials: IMaterialRepository,
    private readonly stock: IStockRepository,
    private readonly activity: IActivityLogRepository
  ) {}

  /** Start a DRAFT count. Each line snapshots the current derived on-hand as
   *  systemQty so the variance is meaningful; nothing posts yet. */
  async create(actor: Actor, input: CycleCountInput): Promise<{ id: string }> {
    assertCan(actor, "create", "CycleCount");
    const lines = await this.buildLines(input.lines);
    return this.counts.withTransaction(async (tx) => {
      const number = await this.allocateNumber(tx);
      const created = await this.counts.create(
        {
          number,
          location: input.location?.trim() || null,
          note: input.note?.trim() || null,
          countedById: actor.id,
          lines,
        },
        tx
      );
      await this.activity.log(
        {
          userId: actor.id,
          entityType: "CycleCount",
          entityId: created.id,
          action: "create",
          payload: { number, lines: lines.length },
        },
        tx
      );
      return { id: created.id };
    });
  }

  /** Edit a DRAFT count's items/quantities. Re-snapshots systemQty at save. */
  async update(actor: Actor, input: CycleCountUpdateInput): Promise<void> {
    assertCan(actor, "update", "CycleCount");
    const existing = await this.counts.findStatus(input.id);
    if (!existing) throw new NotFoundError("Cycle count not found.");
    if (existing.status !== CountStatus.DRAFT) {
      throw new ValidationError("Only a draft count can be edited.");
    }
    const lines = await this.buildLines(input.lines);
    await this.counts.withTransaction(async (tx) => {
      await this.counts.updateHeader(
        input.id,
        {
          location: input.location?.trim() || null,
          note: input.note?.trim() || null,
        },
        tx
      );
      await this.counts.replaceLines(input.id, lines, tx);
      await this.activity.log(
        {
          userId: actor.id,
          entityType: "CycleCount",
          entityId: input.id,
          action: "update",
          payload: { lines: lines.length },
        },
        tx
      );
    });
  }

  /** Submit a draft for approval (DRAFT → COMPLETED). Locks the counts. */
  async submit(actor: Actor, id: string): Promise<void> {
    assertCan(actor, "update", "CycleCount");
    const existing = await this.counts.findStatus(id);
    if (!existing) throw new NotFoundError("Cycle count not found.");
    if (existing.status !== CountStatus.DRAFT) {
      throw new ValidationError("Only a draft count can be submitted.");
    }
    await this.counts.withTransaction(async (tx) => {
      await this.counts.setStatus(id, { status: CountStatus.COMPLETED }, tx);
      await this.activity.log(
        {
          userId: actor.id,
          entityType: "CycleCount",
          entityId: id,
          action: "submit",
          payload: {},
        },
        tx
      );
    });
  }

  /** Approve a submitted count → post COUNT ledger rows so on-hand equals the
   *  physical count. The posted delta is recomputed against CURRENT on-hand at
   *  approval time (physical count is the source of truth). */
  async approve(actor: Actor, input: CycleCountDecisionInput): Promise<void> {
    assertCan(actor, "approve", "CycleCount");
    const count = await this.counts.findForApproval(input.id);
    if (!count) throw new NotFoundError("Cycle count not found.");
    if (count.status !== CountStatus.COMPLETED) {
      throw new ValidationError(
        "Only a submitted (completed) count can be approved."
      );
    }

    // Aggregate counted target per material (a doc may list an item once).
    const targetByMaterial = new Map<
      string,
      { countedQty: number; unitCost: string }
    >();
    for (const l of count.lines) {
      targetByMaterial.set(l.materialId, {
        countedQty: l.countedQty,
        unitCost: l.unitCost.toString(),
      });
    }

    await this.counts.withTransaction(async (tx) => {
      await this.counts.setStatus(
        input.id,
        {
          status: CountStatus.APPROVED,
          approvedById: actor.id,
          approvedAt: new Date(),
        },
        tx
      );
      for (const [materialId, target] of targetByMaterial) {
        const onHand = await this.stock.onHandOne(materialId);
        const delta = target.countedQty - onHand;
        if (delta === 0) continue; // no variance → nothing to post
        await this.stock.postEntry(
          {
            materialId,
            type: LedgerType.COUNT,
            qtyIn: delta > 0 ? delta : 0,
            qtyOut: delta < 0 ? -delta : 0,
            unitCost: target.unitCost,
            refType: "CycleCount",
            refId: input.id,
            note: "Cycle count variance",
            createdById: actor.id,
          },
          tx
        );
      }
      await this.activity.log(
        {
          userId: actor.id,
          entityType: "CycleCount",
          entityId: input.id,
          action: "approve",
          payload: { note: input.note?.trim() || null },
        },
        tx
      );
    });
  }

  /** Cancel a count that hasn't been approved. Posts nothing. */
  async cancel(actor: Actor, id: string): Promise<void> {
    assertCan(actor, "update", "CycleCount");
    const existing = await this.counts.findStatus(id);
    if (!existing) throw new NotFoundError("Cycle count not found.");
    if (existing.status === CountStatus.APPROVED) {
      throw new ValidationError("An approved count can't be cancelled.");
    }
    if (existing.status === CountStatus.CANCELLED) {
      throw new ValidationError("This count is already cancelled.");
    }
    await this.counts.withTransaction(async (tx) => {
      await this.counts.setStatus(id, { status: CountStatus.CANCELLED }, tx);
      await this.activity.log(
        {
          userId: actor.id,
          entityType: "CycleCount",
          entityId: id,
          action: "cancel",
          payload: {},
        },
        tx
      );
    });
  }

  async list(
    _actor: Actor,
    filters: CycleCountListFilters
  ): Promise<CycleCountListPageDto> {
    const { rows, nextCursor } = await this.counts.listPage(filters);
    return { rows: rows.map(mapListRow), nextCursor };
  }

  async get(_actor: Actor, id: string): Promise<CycleCountDetailDto> {
    const count = await this.counts.findDetail(id);
    if (!count) throw new NotFoundError("Cycle count not found.");
    return mapDetail(count);
  }

  /** Validate materials, snapshot system on-hand, default the valuation cost. */
  private async buildLines(
    inputLines: CycleCountInput["lines"]
  ): Promise<CountLineData[]> {
    const ids = [...new Set(inputLines.map((l) => l.materialId))];
    const materials = await this.materials.listByIds(ids);
    if (materials.length !== ids.length) {
      throw new ValidationError("An item on this count no longer exists.");
    }
    const byId = new Map(materials.map((m) => [m.id, m]));
    const onHand = await this.stock.onHandByMaterial(ids);
    return inputLines.map((l) => {
      const m = byId.get(l.materialId)!;
      return {
        materialId: l.materialId,
        systemQty: onHand.get(l.materialId) ?? 0,
        countedQty: l.countedQty,
        unitCost: parseFloat(m.unitCost.toString()),
      };
    });
  }

  private async allocateNumber(
    tx: Parameters<IStockRepository["nextCounter"]>[1]
  ): Promise<string> {
    const prefix = `CC-${BRANCH_CODE}-${format(new Date(), "yyMM")}`;
    for (let i = 0; i < 500; i++) {
      const seq = await this.stock.nextCounter(`cc:${prefix}`, tx);
      const candidate = `${prefix}-${String(seq).padStart(5, "0")}`;
      if (!(await this.counts.numberExists(candidate, tx))) return candidate;
    }
    throw new ValidationError("Could not allocate a cycle count number.");
  }
}

// ——— record → DTO ———

function mapListRow(r: CycleCountListRecord): CycleCountListRowDto {
  return {
    id: r.id,
    number: r.number,
    status: r.status,
    location: r.location,
    lineCount: r.lines.length,
    netVariance: r.lines.reduce((s, l) => s + (l.countedQty - l.systemQty), 0),
    countedByName: r.countedBy.name,
    countedAt: r.countedAt.toISOString(),
    approvedByName: r.approvedBy?.name ?? null,
    approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
  };
}

function mapDetail(r: CycleCountDetailRecord): CycleCountDetailDto {
  return {
    id: r.id,
    number: r.number,
    status: r.status,
    location: r.location,
    note: r.note,
    lineCount: r.lines.length,
    netVariance: r.lines.reduce((s, l) => s + (l.countedQty - l.systemQty), 0),
    countedByName: r.countedBy.name,
    countedAt: r.countedAt.toISOString(),
    approvedByName: r.approvedBy?.name ?? null,
    approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
    lines: r.lines.map((l) => {
      const variance = l.countedQty - l.systemQty;
      const unitCost = parseFloat(l.unitCost.toString());
      return {
        id: l.id,
        materialId: l.materialId,
        code: l.material.code,
        name: l.material.name,
        unit: l.material.unit,
        systemQty: l.systemQty,
        countedQty: l.countedQty,
        variance,
        unitCost: l.unitCost.toString(),
        varianceValue: signed(variance * unitCost),
      };
    }),
  };
}

let instance: CycleCountService | undefined;

export function getCycleCountService(): CycleCountService {
  instance ??= new CycleCountService(
    new PrismaCycleCountRepository(),
    new PrismaMaterialRepository(),
    new PrismaStockRepository(),
    new PrismaActivityLogRepository()
  );
  return instance;
}
