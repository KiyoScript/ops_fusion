import { assertCan } from "@/lib/ability";
import type { Actor } from "@/lib/authz";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { ChequeStatus } from "@/generated/prisma/enums";
import type { IActivityLogRepository } from "@/modules/shared/repositories/activity-log-repository";
import { PrismaActivityLogRepository } from "@/modules/shared/repositories/activity-log-repository";
import {
  PrismaChequeRepository,
  type ChequeRecord,
  type IChequeRepository,
} from "../repositories/cheque-repository";
import {
  CHEQUE_STATUS_LABEL,
  type BounceChequeInput,
  type BounceResultDto,
  type ChequeDto,
  type ChequeFilters,
  type ChequeRegisterDto,
  type ClearChequesInput,
  type DepositChequesInput,
} from "../schemas/cheque";
import { getReceiptService } from "./receipt-service";
import { RECEIPT_KIND } from "../schemas/receipt";

// ══════════════════════════════════════════════════════════════════════════
// CHEQUES — a cheque is not money until it clears.
//
// The shop takes a cheque, writes a receipt, and the invoice reads settled.
// If that cheque comes back, the receivable has to come back with it. Before
// this existed CHECK was a label on a payment method and nothing more, so a
// DAIF cheque closed a real debt permanently and nobody was ever told.
//
// Two things follow from that, and they are the whole module:
//
//   1. Every cheque has a state, and only CLEARED is money. RECEIVED and
//      DEPOSITED are undeposited funds and float — the shop holds paper.
//   2. BOUNCED reverses the receipt the cheque paid for, which is what puts
//      the debt back on the A/R ledger.
// ══════════════════════════════════════════════════════════════════════════

/**
 * Which states a cheque may move to from where it is.
 *
 * Forward only, with one exception that matters: a DEPOSITED cheque may still
 * bounce, and so may a CLEARED one — banks reverse credited items days later,
 * and a shop that cannot record that is back to a debt closed by money that
 * left again. What is refused is going backwards (un-depositing) and touching
 * one that has already bounced.
 */
const ALLOWED: Record<ChequeStatus, ChequeStatus[]> = {
  RECEIVED: [ChequeStatus.DEPOSITED, ChequeStatus.BOUNCED],
  DEPOSITED: [ChequeStatus.CLEARED, ChequeStatus.BOUNCED],
  CLEARED: [ChequeStatus.BOUNCED],
  BOUNCED: [],
};

function assertTransition(cheque: ChequeRecord, to: ChequeStatus): void {
  if (ALLOWED[cheque.status].includes(to)) return;
  throw new ValidationError(
    `Cheque ${cheque.chequeNo} is ${CHEQUE_STATUS_LABEL[cheque.status].toLowerCase()} — ` +
      `it cannot be marked ${CHEQUE_STATUS_LABEL[to].toLowerCase()} from there.`
  );
}

/** The receipt a cheque paid for, whichever ledger it lives in. */
function receiptOf(c: ChequeRecord) {
  const { sale, collectionReceipt } = c.receiptPayment;
  if (sale) {
    return {
      kind: "sale" as const,
      id: sale.id,
      documentNo: sale.documentNo,
      customerId: sale.customer.id,
      customerName: sale.customer.name,
      joNumber: sale.jobOrder?.joNumber ?? null,
      receivedAt: sale.saleDate,
      cancelled: sale.voidedAt !== null,
      tenderCount: sale._count.payments,
    };
  }
  if (collectionReceipt) {
    return {
      kind: "collection" as const,
      id: collectionReceipt.id,
      documentNo: collectionReceipt.crNumber,
      customerId: collectionReceipt.customer.id,
      customerName: collectionReceipt.customer.name,
      joNumber: collectionReceipt.jobOrder?.joNumber ?? null,
      receivedAt: collectionReceipt.receivedAt,
      cancelled: collectionReceipt.voidedAt !== null,
      tenderCount: collectionReceipt._count.payments,
    };
  }
  return null;
}

function toDto(c: ChequeRecord): ChequeDto {
  const receipt = receiptOf(c);
  return {
    id: c.id,
    chequeNo: c.chequeNo,
    bank: c.bank,
    chequeDate: c.chequeDate?.toISOString() ?? null,
    status: c.status,
    statusLabel: CHEQUE_STATUS_LABEL[c.status],
    amount: c.receiptPayment.amount.toFixed(2),
    customerId: receipt?.customerId ?? null,
    customerName: receipt?.customerName ?? "—",
    documentNo: receipt?.documentNo ?? null,
    joNumber: receipt?.joNumber ?? null,
    receivedAt: (receipt?.receivedAt ?? c.createdAt).toISOString(),
    isSoleTender: receipt?.tenderCount === 1,
    receiptCancelled: receipt?.cancelled ?? false,
    depositSlipNo: c.depositSlipNo,
    depositedAt: c.depositedAt?.toISOString() ?? null,
    depositedByName: c.depositedBy?.name ?? null,
    clearedAt: c.clearedAt?.toISOString() ?? null,
    clearedByName: c.clearedBy?.name ?? null,
    bouncedAt: c.bouncedAt?.toISOString() ?? null,
    bouncedByName: c.bouncedBy?.name ?? null,
    bounceReason: c.bounceReason,
  };
}

export class ChequeService {
  constructor(
    private readonly cheques: IChequeRepository,
    private readonly activity: IActivityLogRepository
  ) {}

  /** R9 — the register names customers and what they owe. Gated like any
   *  other money read. */
  async list(actor: Actor, filters: ChequeFilters): Promise<ChequeRegisterDto> {
    assertCan(actor, "read", "Sale");
    const [rows, totals] = await Promise.all([
      this.cheques.list({
        status: filters.status,
        q: filters.q,
        dueBy: filters.depositableOnly ? new Date() : undefined,
      }),
      this.cheques.totals(),
    ]);
    return { rows: rows.map(toDto), totals };
  }

  /** Lodged with the bank. Still not money — that is what CLEARED is for. */
  async deposit(
    actor: Actor,
    input: DepositChequesInput
  ): Promise<{ moved: number }> {
    return this.transition(actor, input.chequeIds, ChequeStatus.DEPOSITED, {
      depositSlipNo: input.depositSlipNo?.trim() || null,
      depositedAt: new Date(),
      depositedById: actor.id,
    });
  }

  /** The funds are actually in the bank. Only now is the cheque money. */
  async clear(
    actor: Actor,
    input: ClearChequesInput
  ): Promise<{ moved: number }> {
    return this.transition(actor, input.chequeIds, ChequeStatus.CLEARED, {
      clearedAt: new Date(),
      clearedById: actor.id,
    });
  }

  private async transition(
    actor: Actor,
    ids: string[],
    to: ChequeStatus,
    data: Record<string, unknown>
  ): Promise<{ moved: number }> {
    // Moving a cheque toward the bank is ordinary counter work; it is bouncing
    // one that takes authority, because that is what reopens a debt.
    assertCan(actor, "create", "Sale");

    const found = await this.cheques.findManyByIds(ids);
    if (found.length !== ids.length) {
      throw new NotFoundError("One of those cheques no longer exists.");
    }
    // Checked BEFORE anything is written: a batch that half-applies leaves the
    // register lying about where the cheques are.
    for (const c of found) assertTransition(c, to);

    await this.cheques.withTransaction(async (tx) => {
      for (const c of found) {
        await this.cheques.mark(c.id, { status: to, ...data }, tx);
      }
    });

    for (const c of found) {
      await this.activity.log({
        userId: actor.id,
        entityType: "Cheque",
        entityId: c.id,
        // R12 — its own action, never a generic "update".
        action: to === ChequeStatus.DEPOSITED ? "deposit-cheque" : "clear-cheque",
        payload: {
          chequeNo: c.chequeNo,
          amount: c.receiptPayment.amount.toFixed(2),
          ...data,
        },
      });
    }
    return { moved: found.length };
  }

  /**
   * The bank returned it. The debt it paid for is open again.
   *
   * The reversal is deliberately NOT new machinery: cancelling the receipt is
   * what the shop already does on paper, and `voidReceipt` already unwinds
   * everything correctly — it reverses the allocations that closed the
   * invoices, hands back any credit the overpayment created, and keeps the
   * serial in the booklet (R11). A bounce is that same act with a different
   * reason written on the leaf.
   *
   * It is refused on a SPLIT receipt. If ₱1,000 came in as cash and ₱2,000 as
   * a cheque, cancelling the whole receipt would also unpick the ₱1,000 that
   * genuinely arrived. Reversing only part of it would break the identity the
   * collection ledger rests on — `amount + creditApplied = sum(allocations) +
   * creditCreated` (R5) — so instead the cheque is marked bounced, the
   * follow-up is stated plainly, and the cashier cancels and reissues for the
   * part that was real. That is the same thing they would do at the counter.
   */
  async bounce(
    actor: Actor,
    input: BounceChequeInput
  ): Promise<BounceResultDto> {
    // Reopening a receivable is supervisor work — the same authority that
    // cancels a receipt, because that is exactly what this does.
    assertCan(actor, "void", "Sale");

    const cheque = await this.cheques.findById(input.chequeId);
    if (!cheque) throw new NotFoundError("Cheque not found.");
    assertTransition(cheque, ChequeStatus.BOUNCED);

    const receipt = receiptOf(cheque);
    const reason = input.reason.trim();
    const bouncedAt = new Date();

    await this.cheques.mark(cheque.id, {
      status: ChequeStatus.BOUNCED,
      bouncedAt,
      bouncedById: actor.id,
      bounceReason: reason,
    });

    let receiptReversed = false;
    let followUp: string | null = null;

    if (!receipt) {
      followUp = "This cheque is not attached to a receipt — nothing to reverse.";
    } else if (receipt.cancelled) {
      // Already off the ledger; reversing again would be wrong and voidReceipt
      // would refuse anyway.
      followUp = `${receipt.documentNo ?? "That receipt"} was already cancelled, so nothing was owed against it.`;
    } else if (receipt.tenderCount > 1) {
      followUp =
        `${receipt.documentNo ?? "That receipt"} was paid more than one way, so it was left standing — ` +
        `cancelling it would also unpick the money that did arrive. Cancel it and reissue for the rest.`;
    } else {
      await getReceiptService().voidReceipt(actor, {
        receiptId: receipt.id,
        kind:
          receipt.kind === "collection"
            ? RECEIPT_KIND.COLLECTION
            : RECEIPT_KIND.SI_VAT,
        reason: `Cheque ${cheque.chequeNo} bounced — ${reason}`,
      });
      receiptReversed = true;
    }

    await this.activity.log({
      userId: actor.id,
      entityType: "Cheque",
      entityId: cheque.id,
      action: "bounce-cheque",
      payload: {
        chequeNo: cheque.chequeNo,
        amount: cheque.receiptPayment.amount.toFixed(2),
        reason,
        documentNo: receipt?.documentNo ?? null,
        customerName: receipt?.customerName ?? null,
        receiptReversed,
        followUp,
      },
    });

    return {
      id: cheque.id,
      chequeNo: cheque.chequeNo,
      receiptReversed,
      followUp,
    };
  }
}

let instance: ChequeService | undefined;

export function getChequeService(): ChequeService {
  if (!instance) {
    instance = new ChequeService(
      new PrismaChequeRepository(),
      new PrismaActivityLogRepository()
    );
  }
  return instance;
}
