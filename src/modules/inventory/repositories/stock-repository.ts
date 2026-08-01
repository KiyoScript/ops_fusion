import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type { LedgerType } from "@/generated/prisma/enums";
import type { DbTx } from "@/modules/shared/repositories/types";

// ══════════════════════════════════════════════════════════════════════════
// Stock ledger — append-only movement log and the DERIVED stock-on-hand.
// On-hand is NEVER stored: it is Σ(qtyIn − qtyOut) over the ledger, in pcs.
// Every posting (opening, adjustment, count) writes rows here; corrections are
// new rows, never edits.
// ══════════════════════════════════════════════════════════════════════════

export type LedgerPost = {
  materialId: string;
  type: LedgerType;
  qtyIn: number; // pcs added (≥ 0)
  qtyOut: number; // pcs removed (≥ 0)
  unitCost: number | string; // per pc
  refType?: string | null;
  refId?: string | null;
  note?: string | null;
  createdById: string;
  occurredAt?: Date;
};

const ledgerSelect = {
  id: true,
  type: true,
  qtyIn: true,
  qtyOut: true,
  unitCost: true,
  totalValue: true,
  refType: true,
  refId: true,
  note: true,
  occurredAt: true,
  createdBy: { select: { name: true } },
} satisfies Prisma.StockLedgerEntrySelect;

export type LedgerRecord = Prisma.StockLedgerEntryGetPayload<{
  select: typeof ledgerSelect;
}>;

export interface IStockRepository {
  /** Net on-hand (pcs) per material: Σ qtyIn − Σ qtyOut. Materials with no
   *  ledger rows are absent from the map (treat as 0). */
  onHandByMaterial(materialIds?: string[]): Promise<Map<string, number>>;
  onHandOne(materialId: string): Promise<number>;
  /** Recent movements for one material, newest first. */
  listMovements(materialId: string, take?: number): Promise<LedgerRecord[]>;
  /** Append one ledger row. totalValue is signed: (qtyIn − qtyOut) × unitCost. */
  postEntry(entry: LedgerPost, tx: DbTx): Promise<void>;
  /** Atomic per-key sequence for document numbers (ADJ-/CC- series). */
  nextCounter(key: string, tx: DbTx): Promise<number>;
}

export class PrismaStockRepository implements IStockRepository {
  async onHandByMaterial(
    materialIds?: string[]
  ): Promise<Map<string, number>> {
    const grouped = await prisma.stockLedgerEntry.groupBy({
      by: ["materialId"],
      ...(materialIds ? { where: { materialId: { in: materialIds } } } : {}),
      _sum: { qtyIn: true, qtyOut: true },
    });
    const map = new Map<string, number>();
    for (const g of grouped) {
      map.set(g.materialId, (g._sum.qtyIn ?? 0) - (g._sum.qtyOut ?? 0));
    }
    return map;
  }

  async onHandOne(materialId: string): Promise<number> {
    const agg = await prisma.stockLedgerEntry.aggregate({
      where: { materialId },
      _sum: { qtyIn: true, qtyOut: true },
    });
    return (agg._sum.qtyIn ?? 0) - (agg._sum.qtyOut ?? 0);
  }

  async listMovements(
    materialId: string,
    take = 100
  ): Promise<LedgerRecord[]> {
    return prisma.stockLedgerEntry.findMany({
      where: { materialId },
      select: ledgerSelect,
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take,
    });
  }

  async postEntry(entry: LedgerPost, tx: DbTx): Promise<void> {
    const unit =
      typeof entry.unitCost === "string"
        ? parseFloat(entry.unitCost)
        : entry.unitCost;
    const totalValue = (entry.qtyIn - entry.qtyOut) * unit;
    await tx.stockLedgerEntry.create({
      data: {
        materialId: entry.materialId,
        type: entry.type,
        qtyIn: entry.qtyIn,
        qtyOut: entry.qtyOut,
        unitCost: entry.unitCost,
        totalValue: totalValue.toFixed(2),
        refType: entry.refType ?? null,
        refId: entry.refId ?? null,
        note: entry.note ?? null,
        createdById: entry.createdById,
        ...(entry.occurredAt ? { occurredAt: entry.occurredAt } : {}),
      },
    });
  }

  async nextCounter(key: string, tx: DbTx): Promise<number> {
    const counter = await tx.counter.upsert({
      where: { key },
      create: { key, value: 1 },
      update: { value: { increment: 1 } },
    });
    return counter.value;
  }
}
