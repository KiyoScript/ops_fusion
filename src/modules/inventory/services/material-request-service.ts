import { format } from "date-fns";
import { NotFoundError, ValidationError } from "@/lib/errors";
import type { Actor } from "@/lib/authz";
import { assertCan } from "@/lib/ability";
import { LedgerType, MrStatus } from "@/generated/prisma/enums";
import type { IActivityLogRepository } from "@/modules/shared/repositories/activity-log-repository";
import { PrismaActivityLogRepository } from "@/modules/shared/repositories/activity-log-repository";
import type { IMaterialRepository } from "../repositories/material-repository";
import { PrismaMaterialRepository } from "../repositories/material-repository";
import type { IStockRepository } from "../repositories/stock-repository";
import { PrismaStockRepository } from "../repositories/stock-repository";
import type {
  IMaterialRequestRepository,
  MrDetailRecord,
  MrLineCreate,
  MrListRecord,
} from "../repositories/material-request-repository";
import { PrismaMaterialRequestRepository } from "../repositories/material-request-repository";
import type {
  DuplicateJoHintDto,
  MrDetailDto,
  MrEditInput,
  MrDecisionInput,
  MrListFilters,
  MrListPageDto,
  MrListRowDto,
  MrReleaseInput,
  MrSubmitInput,
} from "../schemas/material-request";

const BRANCH_CODE = "ORM";
const money = (n: number): string => n.toFixed(2);

export class MaterialRequestService {
  constructor(
    private readonly mrs: IMaterialRequestRepository,
    private readonly materials: IMaterialRepository,
    private readonly stock: IStockRepository,
    private readonly activity: IActivityLogRepository
  ) {}

  /** Snapshot on-hand + unit cost per requested line, validating materials. */
  private async buildLines(input: MrSubmitInput["lines"]): Promise<MrLineCreate[]> {
    const ids = [...new Set(input.map((l) => l.materialId))];
    const materials = await this.materials.listByIds(ids);
    if (materials.length !== ids.length) {
      throw new ValidationError("An item on this request no longer exists.");
    }
    const byId = new Map(materials.map((m) => [m.id, m]));
    const onHand = await this.stock.onHandByMaterial(ids);
    return input.map((l) => {
      const m = byId.get(l.materialId)!;
      return {
        materialId: l.materialId,
        qtyNeeded: l.qtyNeeded,
        systemQtyAtRequest: onHand.get(l.materialId) ?? 0,
        unitCostAtRequest: parseFloat(m.unitCost.toString()),
      };
    });
  }

  private async validateJo(jobOrderId?: string | null): Promise<string | null> {
    if (!jobOrderId) return null;
    if (!(await this.mrs.jobOrderExists(jobOrderId))) {
      throw new ValidationError("The selected job order no longer exists.");
    }
    return jobOrderId;
  }

  async submit(actor: Actor, input: MrSubmitInput): Promise<{ id: string }> {
    assertCan(actor, "create", "MaterialRequest");
    const jobOrderId = await this.validateJo(input.jobOrderId);
    const lines = await this.buildLines(input.lines);
    return this.mrs.withTransaction(async (tx) => {
      const number = await this.allocateNumber(tx);
      const created = await this.mrs.create(
        {
          number,
          jobOrderId,
          purpose: input.purpose?.trim() || null,
          requestedById: actor.id,
          lines,
        },
        tx
      );
      await this.activity.log(
        { userId: actor.id, entityType: "MaterialRequest", entityId: created.id, action: "submit", payload: { number, lines: lines.length } },
        tx
      );
      return { id: created.id };
    });
  }

  /** Edit + resubmit a REJECTED request (back to PENDING). */
  async edit(actor: Actor, input: MrEditInput): Promise<void> {
    assertCan(actor, "create", "MaterialRequest");
    const mr = await this.mrs.findForDecision(input.id);
    if (!mr) throw new NotFoundError("Material request not found.");
    if (mr.status !== MrStatus.REJECTED) {
      throw new ValidationError("Only a rejected request can be edited and resubmitted.");
    }
    const jobOrderId = await this.validateJo(input.jobOrderId);
    const lines = await this.buildLines(input.lines);
    await this.mrs.withTransaction(async (tx) => {
      await this.mrs.replaceForEdit(input.id, { jobOrderId, purpose: input.purpose?.trim() || null, lines }, tx);
      await this.activity.log(
        { userId: actor.id, entityType: "MaterialRequest", entityId: input.id, action: "edit", payload: { lines: lines.length } },
        tx
      );
    });
  }

  async cancel(actor: Actor, id: string): Promise<void> {
    assertCan(actor, "create", "MaterialRequest");
    const mr = await this.mrs.findForDecision(id);
    if (!mr) throw new NotFoundError("Material request not found.");
    if (mr.lines.some((l) => l.qtyReleased > 0)) {
      throw new ValidationError("This request already has released stock — correct it with a Stock Adjustment instead.");
    }
    if (mr.status === MrStatus.RELEASED || mr.status === MrStatus.CANCELLED) {
      throw new ValidationError(`This request is already ${mr.status.toLowerCase()}.`);
    }
    await this.mrs.withTransaction(async (tx) => {
      await this.mrs.setStatus(id, MrStatus.CANCELLED, tx);
      await this.activity.log(
        { userId: actor.id, entityType: "MaterialRequest", entityId: id, action: "cancel", payload: {} },
        tx
      );
    });
  }

  async approve(actor: Actor, input: MrDecisionInput): Promise<void> {
    assertCan(actor, "approve", "MaterialRequest");
    const mr = await this.mrs.findForDecision(input.id);
    if (!mr) throw new NotFoundError("Material request not found.");
    if (mr.status !== MrStatus.PENDING) {
      throw new ValidationError(`This request is already ${mr.status.toLowerCase().replace("_", " ")}.`);
    }
    await this.mrs.withTransaction(async (tx) => {
      await this.mrs.setDecision(input.id, { status: MrStatus.APPROVED, decidedById: actor.id, decisionNote: input.note?.trim() || null }, tx);
      await this.activity.log(
        { userId: actor.id, entityType: "MaterialRequest", entityId: input.id, action: "approve", payload: {} },
        tx
      );
    });
  }

  async reject(actor: Actor, input: MrDecisionInput): Promise<void> {
    assertCan(actor, "approve", "MaterialRequest");
    const mr = await this.mrs.findForDecision(input.id);
    if (!mr) throw new NotFoundError("Material request not found.");
    if (mr.status !== MrStatus.PENDING) {
      throw new ValidationError(`Only a pending request can be rejected (this one is ${mr.status.toLowerCase().replace("_", " ")}).`);
    }
    await this.mrs.withTransaction(async (tx) => {
      await this.mrs.setDecision(input.id, { status: MrStatus.REJECTED, decidedById: actor.id, decisionNote: input.note?.trim() || null }, tx);
      await this.activity.log(
        { userId: actor.id, entityType: "MaterialRequest", entityId: input.id, action: "reject", payload: {} },
        tx
      );
    });
  }

  /** Release stock against an approved request — posts RELEASE ledger rows.
   *  Per-line partial quantity allowed; short of stock is blocked per material. */
  async release(actor: Actor, input: MrReleaseInput): Promise<void> {
    assertCan(actor, "release", "MaterialRequest");
    const mr = await this.mrs.findForRelease(input.id);
    if (!mr) throw new NotFoundError("Material request not found.");
    if (mr.status !== MrStatus.APPROVED && mr.status !== MrStatus.PARTIALLY_RELEASED) {
      throw new ValidationError("Only an approved request can be released.");
    }

    const byLine = new Map(mr.lines.map((l) => [l.id, l]));
    const toRelease: { line: (typeof mr.lines)[number]; qty: number }[] = [];
    for (const req of input.lines) {
      if (req.qty <= 0) continue;
      const line = byLine.get(req.lineId);
      if (!line) throw new ValidationError("A line is not part of this request.");
      const remaining = line.qtyNeeded - line.qtyReleased;
      if (req.qty > remaining) {
        throw new ValidationError(`${line.material.code}: only ${remaining} left to release (requested ${req.qty}).`);
      }
      toRelease.push({ line, qty: req.qty });
    }
    if (toRelease.length === 0) {
      throw new ValidationError("Enter a quantity to release on at least one line.");
    }

    // Stock guard: total release demand per material must not exceed on-hand.
    const demand = new Map<string, number>();
    for (const r of toRelease) {
      demand.set(r.line.materialId, (demand.get(r.line.materialId) ?? 0) + r.qty);
    }
    for (const [materialId, qty] of demand) {
      const onHand = await this.stock.onHandOne(materialId);
      if (qty > onHand) {
        const code = (await this.materials.findById(materialId))?.code ?? "Item";
        throw new ValidationError(`${code}: only ${onHand} pc(s) on hand, cannot release ${qty}.`);
      }
    }

    await this.mrs.withTransaction(async (tx) => {
      for (const r of toRelease) {
        await this.stock.postEntry(
          {
            materialId: r.line.materialId,
            type: LedgerType.RELEASE,
            qtyIn: 0,
            qtyOut: r.qty,
            unitCost: r.line.unitCostAtRequest.toString(),
            refType: "MaterialRequest",
            refId: mr.id,
            note: `MR issue · ${mr.number}`,
            createdById: actor.id,
          },
          tx
        );
        await this.mrs.addReleased(r.line.id, r.qty, tx);
      }
      // Roll up status from the resulting per-line released totals.
      const releasedById = new Map(toRelease.map((r) => [r.line.id, r.qty]));
      const fullyReleased = mr.lines.every(
        (l) => l.qtyReleased + (releasedById.get(l.id) ?? 0) >= l.qtyNeeded
      );
      const status = fullyReleased ? MrStatus.RELEASED : MrStatus.PARTIALLY_RELEASED;
      await this.mrs.applyRelease(input.id, { status, releasedById: actor.id, releaseNote: input.note.trim() }, tx);
      await this.activity.log(
        { userId: actor.id, entityType: "MaterialRequest", entityId: input.id, action: "release", payload: { lines: toRelease.length, status } },
        tx
      );
    });
  }

  async list(_actor: Actor, filters: MrListFilters): Promise<MrListPageDto> {
    const { rows, nextCursor } = await this.mrs.listPage(filters);
    return { rows: rows.map(mapListRow), nextCursor };
  }

  async get(_actor: Actor, id: string): Promise<MrDetailDto> {
    const mr = await this.mrs.findDetail(id);
    if (!mr) throw new NotFoundError("Material request not found.");
    const onHand = await this.stock.onHandByMaterial(mr.lines.map((l) => l.materialId));
    return mapDetail(mr, onHand);
  }

  async duplicateHint(_actor: Actor, jobOrderId: string): Promise<DuplicateJoHintDto> {
    const existing = await this.mrs.findByJobOrder(jobOrderId);
    return { jobOrderId, existing };
  }

  private async allocateNumber(tx: Parameters<IStockRepository["nextCounter"]>[1]): Promise<string> {
    const prefix = `MR-${BRANCH_CODE}-${format(new Date(), "yyMM")}`;
    for (let i = 0; i < 500; i++) {
      const seq = await this.stock.nextCounter(`mr:${prefix}`, tx);
      const candidate = `${prefix}-${String(seq).padStart(5, "0")}`;
      if (!(await this.mrs.numberExists(candidate, tx))) return candidate;
    }
    throw new ValidationError("Could not allocate a material request number.");
  }
}

// ——— record → DTO ———

function costOf(lines: { qtyNeeded: number; unitCostAtRequest: { toString(): string } }[]): number {
  return lines.reduce((sum, l) => sum + l.qtyNeeded * parseFloat(l.unitCostAtRequest.toString()), 0);
}

function mapListRow(r: MrListRecord): MrListRowDto {
  return {
    id: r.id,
    number: r.number,
    status: r.status,
    joNumber: r.jobOrder?.joNumber ?? null,
    purpose: r.purpose,
    lineCount: r.lines.length,
    totalQtyNeeded: r.lines.reduce((s, l) => s + l.qtyNeeded, 0),
    costOfMaterials: money(costOf(r.lines)),
    requestedByName: r.requestedBy.name,
    requestedAt: r.requestedAt.toISOString(),
  };
}

function mapDetail(r: MrDetailRecord, onHand: Map<string, number>): MrDetailDto {
  return {
    id: r.id,
    number: r.number,
    status: r.status,
    jobOrder: r.jobOrder,
    purpose: r.purpose,
    requestedByName: r.requestedBy.name,
    requestedAt: r.requestedAt.toISOString(),
    decidedByName: r.decidedBy?.name ?? null,
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    decisionNote: r.decisionNote,
    releasedByName: r.releasedBy?.name ?? null,
    lastReleasedAt: r.lastReleasedAt ? r.lastReleasedAt.toISOString() : null,
    releaseNote: r.releaseNote,
    costOfMaterials: money(costOf(r.lines)),
    lines: r.lines.map((l) => {
      const unitCost = parseFloat(l.unitCostAtRequest.toString());
      return {
        id: l.id,
        materialId: l.materialId,
        code: l.material.code,
        name: l.material.name,
        unit: l.material.unit,
        qtyNeeded: l.qtyNeeded,
        qtyReleased: l.qtyReleased,
        remaining: l.qtyNeeded - l.qtyReleased,
        onHand: onHand.get(l.materialId) ?? 0,
        systemQtyAtRequest: l.systemQtyAtRequest,
        unitCost: l.unitCostAtRequest.toString(),
        lineCost: money(unitCost * l.qtyNeeded),
      };
    }),
  };
}

let instance: MaterialRequestService | undefined;

export function getMaterialRequestService(): MaterialRequestService {
  instance ??= new MaterialRequestService(
    new PrismaMaterialRequestRepository(),
    new PrismaMaterialRepository(),
    new PrismaStockRepository(),
    new PrismaActivityLogRepository()
  );
  return instance;
}
