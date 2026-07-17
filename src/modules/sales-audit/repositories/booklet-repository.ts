import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { BookletStatus, BookletType } from "@/generated/prisma/enums";
import type { DbTx } from "@/modules/shared/repositories/types";

const bookletSelect = {
  id: true,
  type: true,
  prefix: true,
  label: true,
  seriesStart: true,
  seriesEnd: true,
  nextNumber: true,
  status: true,
  gapExempt: true,
  rejectionNote: true,
  approvedAt: true,
  createdAt: true,
  openedBy: { select: { name: true } },
  approvedBy: { select: { name: true } },
} satisfies Prisma.BookletSelect;

export type BookletRecord = Prisma.BookletGetPayload<{
  select: typeof bookletSelect;
}>;

export type BookletCreateData = {
  type: BookletType;
  prefix: string;
  label: string | null;
  seriesStart: number;
  seriesEnd: number;
  nextNumber: number;
  gapExempt: boolean;
  openedById: string;
};

export interface IBookletRepository {
  withTransaction<T>(fn: (tx: DbTx) => Promise<T>): Promise<T>;
  list(filter: {
    type?: BookletType;
    status?: BookletStatus;
  }): Promise<BookletRecord[]>;
  findById(id: string, tx?: DbTx): Promise<BookletRecord | null>;
  create(data: BookletCreateData): Promise<{ id: string }>;
  /** Highest seriesEnd across ALL booklets of a type — where the next block starts. */
  maxSeriesEnd(type: BookletType): Promise<number>;
  setStatus(
    id: string,
    data: {
      status: BookletStatus;
      approvedById?: string | null;
      approvedAt?: Date | null;
      rejectionNote?: string | null;
    },
    tx?: DbTx
  ): Promise<void>;
  /**
   * The single ACTIVE booklet for a type, locked FOR UPDATE so two cashiers
   * issuing at the same instant serialise instead of racing for one number.
   * Returns null when no booklet is active.
   */
  lockActiveBooklet(
    type: BookletType,
    tx: DbTx
  ): Promise<{
    id: string;
    prefix: string;
    nextNumber: number;
    seriesEnd: number;
  } | null>;
  /** Advance nextNumber; flip to CONSUMED once the range is used up. */
  consumeNumber(
    id: string,
    nextNumber: number,
    seriesEnd: number,
    tx: DbTx
  ): Promise<void>;
  hasIssuedDocuments(id: string): Promise<boolean>;
  delete(id: string): Promise<void>;
}

export class PrismaBookletRepository implements IBookletRepository {
  withTransaction<T>(fn: (tx: DbTx) => Promise<T>): Promise<T> {
    return prisma.$transaction(fn);
  }

  async list(filter: {
    type?: BookletType;
    status?: BookletStatus;
  }): Promise<BookletRecord[]> {
    return prisma.booklet.findMany({
      where: {
        ...(filter.type ? { type: filter.type } : {}),
        ...(filter.status ? { status: filter.status } : {}),
      },
      select: bookletSelect,
      orderBy: [{ type: "asc" }, { seriesStart: "asc" }],
    });
  }

  async findById(id: string, tx?: DbTx): Promise<BookletRecord | null> {
    return (tx ?? prisma).booklet.findUnique({
      where: { id },
      select: bookletSelect,
    });
  }

  async create(data: BookletCreateData): Promise<{ id: string }> {
    return prisma.booklet.create({ data, select: { id: true } });
  }

  async maxSeriesEnd(type: BookletType): Promise<number> {
    const top = await prisma.booklet.findFirst({
      where: { type },
      select: { seriesEnd: true },
      orderBy: { seriesEnd: "desc" },
    });
    return top?.seriesEnd ?? 0;
  }

  async setStatus(
    id: string,
    data: {
      status: BookletStatus;
      approvedById?: string | null;
      approvedAt?: Date | null;
      rejectionNote?: string | null;
    },
    tx?: DbTx
  ): Promise<void> {
    await (tx ?? prisma).booklet.update({ where: { id }, data });
  }

  async lockActiveBooklet(
    type: BookletType,
    tx: DbTx
  ): Promise<{
    id: string;
    prefix: string;
    nextNumber: number;
    seriesEnd: number;
  } | null> {
    // SELECT … FOR UPDATE has no Prisma equivalent, and it is the whole point:
    // it holds the row until this transaction commits, so a concurrent
    // Receive Payment blocks here rather than reading the same nextNumber.
    const rows = await tx.$queryRaw<
      { id: string; prefix: string; nextNumber: number; seriesEnd: number }[]
    >`
      SELECT "id", "prefix", "nextNumber", "seriesEnd"
      FROM "Booklet"
      WHERE "type" = ${type}::"BookletType"
        AND "status" = 'ACTIVE'
      FOR UPDATE`;
    return rows[0] ?? null;
  }

  async consumeNumber(
    id: string,
    nextNumber: number,
    seriesEnd: number,
    tx: DbTx
  ): Promise<void> {
    const advanced = nextNumber + 1;
    await tx.booklet.update({
      where: { id },
      data: {
        nextNumber: advanced,
        // Past the last leaf → the booklet is spent (legacy "Fully Consumed").
        ...(advanced > seriesEnd ? { status: BookletStatus.CONSUMED } : {}),
      },
    });
  }

  async hasIssuedDocuments(id: string): Promise<boolean> {
    const [sale, cr] = await Promise.all([
      prisma.sale.findFirst({ where: { bookletId: id }, select: { id: true } }),
      prisma.collectionReceipt.findFirst({
        where: { bookletId: id },
        select: { id: true },
      }),
    ]);
    return !!sale || !!cr;
  }

  async delete(id: string): Promise<void> {
    await prisma.booklet.delete({ where: { id } });
  }
}
