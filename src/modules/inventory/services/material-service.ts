import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import type { Actor } from "@/lib/authz";
import { assertCan } from "@/lib/ability";
import { LedgerType } from "@/generated/prisma/enums";
import type { IActivityLogRepository } from "@/modules/shared/repositories/activity-log-repository";
import { PrismaActivityLogRepository } from "@/modules/shared/repositories/activity-log-repository";
import type {
  IMaterialRepository,
  MaterialRecord,
} from "../repositories/material-repository";
import { PrismaMaterialRepository } from "../repositories/material-repository";
import type { IStockRepository } from "../repositories/stock-repository";
import { PrismaStockRepository } from "../repositories/stock-repository";
import type { ISupplierRepository } from "../repositories/supplier-repository";
import { PrismaSupplierRepository } from "../repositories/supplier-repository";
import type {
  MaterialDetailDto,
  MaterialDto,
  MaterialFormOptionsDto,
  MaterialInput,
  MaterialListFilters,
  MaterialListPageDto,
  MaterialUpdateInput,
  ReorderRowDto,
} from "../schemas/material";

const money2 = (n: number): string => n.toFixed(2);

export class MaterialService {
  constructor(
    private readonly materials: IMaterialRepository,
    private readonly stock: IStockRepository,
    private readonly suppliers: ISupplierRepository,
    private readonly activity: IActivityLogRepository
  ) {}

  async list(
    _actor: Actor,
    filters: MaterialListFilters
  ): Promise<MaterialListPageDto> {
    const { rows, nextCursor } = await this.materials.listPage(filters);
    const onHand = await this.stock.onHandByMaterial(rows.map((r) => r.id));
    return {
      rows: rows.map((r) => mapMaterial(r, onHand.get(r.id) ?? 0)),
      nextCursor,
    };
  }

  async get(_actor: Actor, id: string): Promise<MaterialDetailDto> {
    const m = await this.materials.findById(id);
    if (!m) throw new NotFoundError("Item not found.");
    const onHand = await this.stock.onHandOne(id);
    const movements = await this.stock.listMovements(id);

    // Running on-hand after each movement. Rows are newest-first; the newest
    // row's balance is the current on-hand, older rows peel back their net.
    let running = onHand;
    const movementDtos = movements.map((mv) => {
      const balance = running;
      running -= mv.qtyIn - mv.qtyOut;
      return {
        id: mv.id,
        type: mv.type as string,
        qtyIn: mv.qtyIn,
        qtyOut: mv.qtyOut,
        unitCost: mv.unitCost.toString(),
        totalValue: mv.totalValue.toString(),
        balance,
        refType: mv.refType,
        refId: mv.refId,
        note: mv.note,
        occurredAt: mv.occurredAt.toISOString(),
        createdByName: mv.createdBy.name,
      };
    });

    return { ...mapMaterial(m, onHand), movements: movementDtos };
  }

  /** Prefixes already in use + active suppliers, for the create/edit form. */
  async getFormOptions(actor: Actor): Promise<MaterialFormOptionsDto> {
    assertCan(actor, "read", "Material");
    const [prefixes, suppliers] = await Promise.all([
      this.materials.listPrefixes(),
      this.suppliers.listActive(),
    ]);
    return { prefixes, suppliers };
  }

  /** Suggest the next code for a prefix, e.g. "PAP" → "PAP-013". */
  async suggestCode(_actor: Actor, prefix: string): Promise<{ code: string }> {
    const clean = prefix.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!clean) throw new ValidationError("Enter a code prefix first.");
    const max = await this.materials.maxSeqForPrefix(clean);
    return { code: `${clean}-${String(max + 1).padStart(3, "0")}` };
  }

  async create(actor: Actor, input: MaterialInput): Promise<{ id: string }> {
    assertCan(actor, "maintain", "Material");
    const code = input.code.trim();
    if (await this.materials.codeExists(code)) {
      throw new ConflictError(`Item code "${code}" already exists.`);
    }
    if (input.supplierId && !(await this.suppliers.findById(input.supplierId))) {
      throw new ValidationError("Selected supplier no longer exists.");
    }

    const { openingQty, ...write } = { ...input, code };
    return this.materials.withTransaction(async (tx) => {
      const created = await this.materials.create(write, actor.id, tx);
      // Opening stock → an OPENING ledger row (valued at the item's unit cost).
      if (openingQty > 0) {
        await this.stock.postEntry(
          {
            materialId: created.id,
            type: LedgerType.OPENING,
            qtyIn: openingQty,
            qtyOut: 0,
            unitCost: write.unitCost,
            refType: "Material",
            refId: created.id,
            note: "Opening stock",
            createdById: actor.id,
          },
          tx
        );
      }
      await this.activity.log(
        {
          userId: actor.id,
          entityType: "Material",
          entityId: created.id,
          action: "create",
          payload: { code: created.code, name: write.name, openingQty },
        },
        tx
      );
      return { id: created.id };
    });
  }

  async update(actor: Actor, input: MaterialUpdateInput): Promise<void> {
    assertCan(actor, "maintain", "Material");
    const { id, ...rest } = input;
    const existing = await this.materials.findById(id);
    if (!existing) throw new NotFoundError("Item not found.");
    if (rest.supplierId && !(await this.suppliers.findById(rest.supplierId))) {
      throw new ValidationError("Selected supplier no longer exists.");
    }

    // Item code is the item's IDENTITY — it is never changed on update. The
    // form shows it read-only; we also pin it to the stored value here so a
    // crafted payload can't rename an item and orphan its ledger history.
    // (openingQty is a create-only convenience; the repo's MaterialWrite omits it.)
    const write = { ...rest, code: existing.code };
    await this.materials.withTransaction(async (tx) => {
      await this.materials.update(id, write, tx);
      await this.activity.log(
        {
          userId: actor.id,
          entityType: "Material",
          entityId: id,
          action: "update",
          payload: { code: existing.code, name: write.name },
        },
        tx
      );
    });
  }

  async archive(actor: Actor, id: string): Promise<void> {
    assertCan(actor, "maintain", "Material");
    const existing = await this.materials.findById(id);
    if (!existing) throw new NotFoundError("Item not found.");
    const onHand = await this.stock.onHandOne(id);
    if (onHand !== 0) {
      throw new ValidationError(
        `Item still has ${onHand} pc(s) on hand — zero it out with an adjustment before archiving.`
      );
    }
    await this.materials.softDelete(id);
    await this.activity.log({
      userId: actor.id,
      entityType: "Material",
      entityId: id,
      action: "archive",
      payload: { code: existing.code },
    });
  }

  /** Reorder report: active items whose derived on-hand is below the reorder
   *  level, most-short first. */
  async reorderReport(actor: Actor): Promise<ReorderRowDto[]> {
    assertCan(actor, "read", "Material");
    const candidates = await this.materials.listReorderCandidates();
    if (candidates.length === 0) return [];
    const onHand = await this.stock.onHandByMaterial(
      candidates.map((c) => c.id)
    );
    return candidates
      .map((m) => {
        const oh = onHand.get(m.id) ?? 0;
        return {
          id: m.id,
          code: m.code,
          name: m.name,
          category: m.category,
          supplierName: m.supplier?.name ?? null,
          onHand: oh,
          reorderLevel: m.reorderLevel,
          shortBy: m.reorderLevel - oh,
          unit: m.unit,
          packSize: m.packSize,
        };
      })
      .filter((r) => r.onHand < r.reorderLevel)
      .sort((a, b) => b.shortBy - a.shortBy);
  }
}

function mapMaterial(m: MaterialRecord, onHand: number): MaterialDto {
  const unitCost = m.unitCost.toString();
  return {
    id: m.id,
    code: m.code,
    name: m.name,
    category: m.category,
    location: m.location,
    area: m.area,
    unit: m.unit,
    packSize: m.packSize,
    unitCost,
    unitPrice: m.unitPrice ? m.unitPrice.toString() : null,
    reorderLevel: m.reorderLevel,
    status: m.status,
    possibleOffcut: m.possibleOffcut,
    supplier: m.supplier,
    onHand,
    stockValue: money2(onHand * parseFloat(unitCost)),
    belowReorder: m.reorderLevel > 0 && onHand < m.reorderLevel,
    notes: m.notes,
    createdAt: m.createdAt.toISOString(),
  };
}

let instance: MaterialService | undefined;

export function getMaterialService(): MaterialService {
  instance ??= new MaterialService(
    new PrismaMaterialRepository(),
    new PrismaStockRepository(),
    new PrismaSupplierRepository(),
    new PrismaActivityLogRepository()
  );
  return instance;
}
