import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { ChequeStatus } from "@/generated/prisma/enums";
import type { DbTx } from "@/modules/shared/repositories/types";

// The cheque, its tender line (which carries the amount), and the receipt it
// paid for. The receipt is what a bounce has to reach: the money it recorded
// has to come back off the ledger.
const chequeSelect = {
  id: true,
  chequeNo: true,
  bank: true,
  chequeDate: true,
  status: true,
  depositSlipNo: true,
  depositedAt: true,
  clearedAt: true,
  bouncedAt: true,
  bounceReason: true,
  createdAt: true,
  depositedBy: { select: { name: true } },
  clearedBy: { select: { name: true } },
  bouncedBy: { select: { name: true } },
  receiptPayment: {
    select: {
      id: true,
      amount: true,
      saleId: true,
      collectionReceiptId: true,
      sale: {
        select: {
          id: true,
          documentNo: true,
          type: true,
          voidedAt: true,
          saleDate: true,
          customer: { select: { id: true, name: true } },
          jobOrder: { select: { joNumber: true } },
          // How many OTHER ways this receipt was paid. A cheque that is the
          // whole tender can be reversed on its own; one line of a split
          // cannot, without unpicking money that did arrive.
          _count: { select: { payments: true } },
        },
      },
      collectionReceipt: {
        select: {
          id: true,
          crNumber: true,
          voidedAt: true,
          receivedAt: true,
          customer: { select: { id: true, name: true } },
          jobOrder: { select: { joNumber: true } },
          _count: { select: { payments: true } },
        },
      },
    },
  },
} satisfies Prisma.ChequeSelect;

export type ChequeRecord = Prisma.ChequeGetPayload<{
  select: typeof chequeSelect;
}>;

export type ChequeFilter = {
  status?: ChequeStatus;
  q?: string;
  /** Only cheques whose face date is on or before this — depositable today. */
  dueBy?: Date;
};

export type ChequeMarkData = {
  status: ChequeStatus;
  depositSlipNo?: string | null;
  depositedAt?: Date;
  depositedById?: string;
  clearedAt?: Date;
  clearedById?: string;
  bouncedAt?: Date;
  bouncedById?: string;
  bounceReason?: string;
};

export interface IChequeRepository {
  withTransaction<T>(fn: (tx: DbTx) => Promise<T>): Promise<T>;
  list(filter: ChequeFilter): Promise<ChequeRecord[]>;
  findById(id: string): Promise<ChequeRecord | null>;
  findManyByIds(ids: string[]): Promise<ChequeRecord[]>;
  mark(id: string, data: ChequeMarkData, tx?: DbTx): Promise<void>;
  /** Totals by status over the WHOLE set, computed in SQL — never over a
   *  page of rows (R7). */
  totals(): Promise<Record<ChequeStatus, { count: number; amount: string }>>;
}

export class PrismaChequeRepository implements IChequeRepository {
  withTransaction<T>(fn: (tx: DbTx) => Promise<T>): Promise<T> {
    return prisma.$transaction(fn);
  }

  async list(filter: ChequeFilter): Promise<ChequeRecord[]> {
    const where: Prisma.ChequeWhereInput = {};
    if (filter.status) where.status = filter.status;
    if (filter.dueBy) {
      // A cheque with no recorded face date is treated as depositable — the
      // shop holds it, so hiding it from the register would lose it.
      where.OR = [{ chequeDate: null }, { chequeDate: { lte: filter.dueBy } }];
    }
    if (filter.q) {
      const contains = { contains: filter.q, mode: "insensitive" as const };
      where.AND = [
        {
          OR: [
            { chequeNo: contains },
            { bank: contains },
            { depositSlipNo: contains },
            { receiptPayment: { sale: { documentNo: contains } } },
            { receiptPayment: { collectionReceipt: { crNumber: contains } } },
            { receiptPayment: { sale: { customer: { name: contains } } } },
            {
              receiptPayment: {
                collectionReceipt: { customer: { name: contains } },
              },
            },
          ],
        },
      ];
    }
    return prisma.cheque.findMany({
      where,
      select: chequeSelect,
      // Oldest first: the cheque that has been sitting in the drawer longest
      // is the one somebody needs to do something about.
      orderBy: [{ chequeDate: "asc" }, { createdAt: "asc" }],
    });
  }

  async findById(id: string): Promise<ChequeRecord | null> {
    return prisma.cheque.findUnique({ where: { id }, select: chequeSelect });
  }

  async findManyByIds(ids: string[]): Promise<ChequeRecord[]> {
    return prisma.cheque.findMany({
      where: { id: { in: ids } },
      select: chequeSelect,
    });
  }

  async mark(id: string, data: ChequeMarkData, tx?: DbTx): Promise<void> {
    await (tx ?? prisma).cheque.update({ where: { id }, data });
  }

  async totals(): Promise<
    Record<ChequeStatus, { count: number; amount: string }>
  > {
    // Grouped in SQL over every cheque, so the tiles are right whatever the
    // list happens to be filtered to (R7).
    const rows = await prisma.$queryRaw<
      { status: ChequeStatus; count: bigint; amount: Prisma.Decimal | null }[]
    >`
      SELECT c."status", COUNT(*)::bigint AS count, SUM(rp."amount") AS amount
      FROM "Cheque" c
      JOIN "ReceiptPayment" rp ON rp."id" = c."receiptPaymentId"
      GROUP BY c."status"
    `;
    const empty = { count: 0, amount: "0.00" };
    const out: Record<ChequeStatus, { count: number; amount: string }> = {
      RECEIVED: { ...empty },
      DEPOSITED: { ...empty },
      CLEARED: { ...empty },
      BOUNCED: { ...empty },
    };
    for (const r of rows) {
      out[r.status] = {
        count: Number(r.count),
        // SUM over an empty group cannot happen here (GROUP BY only yields
        // groups that have rows), but a null guard keeps the type honest.
        amount: r.amount === null ? "0.00" : r.amount.toFixed(2),
      };
    }
    return out;
  }
}
