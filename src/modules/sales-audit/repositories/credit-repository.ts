import { prisma } from "@/lib/prisma";
import { ConflictError } from "@/lib/errors";
import type { AdvancePaymentStatus, PaymentMethod } from "@/generated/prisma/enums";
import type { DbTx } from "@/modules/shared/repositories/types";

// ══════════════════════════════════════════════════════════════════════════
// CUSTOMER CREDIT — money held FOR a customer, the opposite sign to A/R.
//
// Stored as AdvancePayment (advance-payment.prisma). A credit is created when
// a customer hands over more than they owe, and drawn down by a later
// collection — QuickBooks' unapplied payment, in the shop's own vocabulary.
// ══════════════════════════════════════════════════════════════════════════

export type CreditRecord = {
  id: string;
  amount: string;
  /** Drawn down so far, across every application. */
  applied: string;
  /** amount − applied. Zero once fully spent. */
  remaining: string;
  method: PaymentMethod;
  reference: string | null;
  receivedAt: Date;
  status: AdvancePaymentStatus;
  /** The collection whose excess created it — null for a plain advance. */
  sourceDocumentNo: string | null;
  sourceCollectionReceiptId: string | null;
};

export type CreditCreateData = {
  customerId: string;
  amount: string;
  method: PaymentMethod;
  reference: string | null;
  receivedAt: Date;
  notes: string | null;
  createdById: string;
  sourceCollectionReceiptId: string | null;
};

export interface ICreditRepository {
  /** Credits with money left on them, oldest first — the order they spend. */
  listOpen(customerId: string): Promise<CreditRecord[]>;
  /**
   * Every customer holding unspent credit.
   *
   * The A/R ledger needs this to show credit for a customer who owes nothing:
   * they have no open invoice, so an invoice-driven query would never surface
   * them, and money the shop is holding would be invisible.
   */
  listOpenAll(): Promise<(CreditRecord & { customerId: string; customerName: string })[]>;
  /** Every credit for a customer, spent or not, newest first. */
  listAll(customerId: string): Promise<CreditRecord[]>;
  create(data: CreditCreateData, tx: DbTx): Promise<{ id: string }>;
  /**
   * Draw `amount` off one credit for a collection. Guarded in-statement the
   * same way invoice settlement is — two desks spending the same credit at
   * once must not both succeed.
   */
  apply(
    creditId: string,
    amount: string,
    collectionReceiptId: string,
    appliedById: string,
    tx: DbTx
  ): Promise<void>;
  /** Undo everything a cancelled collection did to customer credit. */
  reverseForCollection(crId: string, tx: DbTx): Promise<void>;
  /**
   * How much of the credit THIS collection created has since been spent.
   *
   * Cancelling a collection takes its credit back off the account, which is
   * impossible once that credit has already paid down someone's invoice — the
   * service refuses rather than leaving a settled invoice funded by nothing.
   */
  spentFromCreditsCreatedBy(crId: string): Promise<number>;
}

/** amount − sum(applications) as a decimal string, floored at zero. */
function remainingOf(amount: string, applications: { amount: unknown }[]): string {
  const cents = (v: string) => Math.round(parseFloat(v) * 100);
  const applied = applications.reduce((t, a) => t + cents(String(a.amount)), 0);
  const left = Math.max(cents(amount) - applied, 0);
  return `${Math.floor(left / 100)}.${String(left % 100).padStart(2, "0")}`;
}

function appliedOf(applications: { amount: unknown }[]): string {
  const cents = (v: string) => Math.round(parseFloat(v) * 100);
  const total = applications.reduce((t, a) => t + cents(String(a.amount)), 0);
  return `${Math.floor(total / 100)}.${String(total % 100).padStart(2, "0")}`;
}

const creditSelect = {
  id: true,
  amount: true,
  method: true,
  reference: true,
  receivedAt: true,
  status: true,
  applications: { select: { amount: true } },
  sourceCollectionReceiptId: true,
  sourceCollectionReceipt: { select: { crNumber: true } },
};

type CreditRow = {
  id: string;
  amount: unknown;
  method: PaymentMethod;
  reference: string | null;
  receivedAt: Date;
  status: AdvancePaymentStatus;
  applications: { amount: unknown }[];
  sourceCollectionReceiptId: string | null;
  sourceCollectionReceipt: { crNumber: string | null } | null;
};

const toRecord = (c: CreditRow): CreditRecord => ({
  id: c.id,
  amount: String(c.amount),
  applied: appliedOf(c.applications),
  remaining: remainingOf(String(c.amount), c.applications),
  method: c.method,
  reference: c.reference,
  receivedAt: c.receivedAt,
  status: c.status,
  sourceDocumentNo: c.sourceCollectionReceipt?.crNumber ?? null,
  sourceCollectionReceiptId: c.sourceCollectionReceiptId,
});

export class PrismaCreditRepository implements ICreditRepository {
  async listOpen(customerId: string): Promise<CreditRecord[]> {
    const rows = await prisma.advancePayment.findMany({
      where: {
        customerId,
        deletedAt: null,
        status: { in: ["UNAPPLIED", "PARTIALLY_APPLIED"] },
      },
      select: creditSelect,
      // Oldest credit spends first, the same convention as oldest invoice.
      orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
    });
    return rows.map(toRecord).filter((c) => parseFloat(c.remaining) > 0);
  }

  async listOpenAll(): Promise<
    (CreditRecord & { customerId: string; customerName: string })[]
  > {
    const rows = await prisma.advancePayment.findMany({
      where: {
        deletedAt: null,
        status: { in: ["UNAPPLIED", "PARTIALLY_APPLIED"] },
      },
      select: {
        ...creditSelect,
        customerId: true,
        customer: { select: { name: true } },
      },
      orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
    });
    return rows
      .map((c) => ({
        ...toRecord(c),
        customerId: c.customerId,
        customerName: c.customer.name,
      }))
      .filter((c) => parseFloat(c.remaining) > 0);
  }

  async listAll(customerId: string): Promise<CreditRecord[]> {
    const rows = await prisma.advancePayment.findMany({
      where: { customerId, deletedAt: null },
      select: creditSelect,
      orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
    });
    return rows.map(toRecord);
  }

  async create(data: CreditCreateData, tx: DbTx): Promise<{ id: string }> {
    return tx.advancePayment.create({
      data: { ...data, status: "UNAPPLIED" },
      select: { id: true },
    });
  }

  async apply(
    creditId: string,
    amount: string,
    collectionReceiptId: string,
    appliedById: string,
    tx: DbTx
  ): Promise<void> {
    // Re-check the remaining balance in the same statement that reserves it.
    // A plain read-then-write would let two collections spend one credit twice.
    const reserved = await tx.$executeRaw`
      UPDATE "AdvancePayment" ap
         SET "status" = CASE
               WHEN ap."amount" - COALESCE((
                 SELECT SUM(a."amount") FROM "AdvancePaymentApplication" a
                  WHERE a."advancePaymentId" = ap."id"
               ), 0) - ${amount}::decimal <= 0 THEN 'FULLY_APPLIED'::"AdvancePaymentStatus"
               ELSE 'PARTIALLY_APPLIED'::"AdvancePaymentStatus"
             END
       WHERE ap."id" = ${creditId}
         AND ap."deletedAt" IS NULL
         AND ap."amount" - COALESCE((
               SELECT SUM(a."amount") FROM "AdvancePaymentApplication" a
                WHERE a."advancePaymentId" = ap."id"
             ), 0) >= ${amount}::decimal
    `;
    if (reserved === 0) {
      throw new ConflictError(
        "That credit was spent while this payment was being entered. Reopen the customer and try again."
      );
    }
    await tx.advancePaymentApplication.create({
      data: {
        advancePaymentId: creditId,
        collectionReceiptId,
        amount,
        appliedById,
      },
    });
  }

  async spentFromCreditsCreatedBy(crId: string): Promise<number> {
    return prisma.advancePaymentApplication.count({
      where: { advancePayment: { sourceCollectionReceiptId: crId } },
    });
  }

  async reverseForCollection(crId: string, tx: DbTx): Promise<void> {
    // Credit this collection SPENT goes back on the customer's account. The
    // status is recomputed from what is left rather than assumed: the credit
    // may still be partly spent by some other collection.
    const spent = await tx.advancePaymentApplication.findMany({
      where: { collectionReceiptId: crId },
      select: { id: true, advancePaymentId: true },
    });
    await tx.advancePaymentApplication.deleteMany({
      where: { collectionReceiptId: crId },
    });
    for (const id of new Set(spent.map((s) => s.advancePaymentId))) {
      await tx.$executeRaw`
        UPDATE "AdvancePayment" ap
           SET "status" = CASE
                 WHEN COALESCE((
                   SELECT SUM(a."amount") FROM "AdvancePaymentApplication" a
                    WHERE a."advancePaymentId" = ap."id"
                 ), 0) = 0 THEN 'UNAPPLIED'::"AdvancePaymentStatus"
                 WHEN COALESCE((
                   SELECT SUM(a."amount") FROM "AdvancePaymentApplication" a
                    WHERE a."advancePaymentId" = ap."id"
                 ), 0) >= ap."amount" THEN 'FULLY_APPLIED'::"AdvancePaymentStatus"
                 ELSE 'PARTIALLY_APPLIED'::"AdvancePaymentStatus"
               END
         WHERE ap."id" = ${id}
      `;
    }

    // Credit this collection CREATED never existed if the collection didn't.
    // Soft-deleted rather than dropped: a credit the customer may already have
    // been told about should stay auditable.
    await tx.advancePayment.updateMany({
      where: { sourceCollectionReceiptId: crId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }
}
