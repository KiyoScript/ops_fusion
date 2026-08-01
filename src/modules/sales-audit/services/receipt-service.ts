import { assertCan } from "@/lib/ability";
import type { Actor } from "@/lib/authz";
import { NotFoundError, ValidationError } from "@/lib/errors";
import {
  AuditEntryStatus,
  BookletType,
  PaymentMethod,
  PaymentStatus,
  ReceiptVoidType,
  SaleType,
} from "@/generated/prisma/enums";
import type { IActivityLogRepository } from "@/modules/shared/repositories/activity-log-repository";
import { PrismaActivityLogRepository } from "@/modules/shared/repositories/activity-log-repository";
import type { DbTx } from "@/modules/shared/repositories/types";
import type { IBookletRepository } from "../repositories/booklet-repository";
import { PrismaBookletRepository } from "../repositories/booklet-repository";
import type {
  CrRecord,
  IReceiptRepository,
  JoForReceiptRecord,
  SaleRecord,
} from "../repositories/receipt-repository";
import { PrismaReceiptRepository } from "../repositories/receipt-repository";
import type { AuditReceiptInput } from "../schemas/audit";
import {
  RECEIPT_KIND,
  RECEIPT_KIND_LABEL,
  type DailySalesSummaryDto,
  type PaymentLineDto,
  type ReceiptKind,
  type ReceiptListFilters,
  type ReceiptListPageDto,
  type ReceiptRowDto,
  type ReceivePaymentInput,
  type ReceivePaymentOptionsDto,
  type ReplaceReceiptInput,
  type VoidReceiptInput,
} from "../schemas/receipt";
import { formatDocumentNo } from "./booklet-service";
import {
  dominantTender,
  paymentStatusOf,
  settleTenders,
  splitVat,
  toAmount,
  toCentavos,
} from "./money";

// Which booklet a receipt kind draws its number from, and — for the three
// revenue kinds — which SaleType it is filed as.
const KIND_BOOKLET: Record<ReceiptKind, BookletType> = {
  JO_RECEIPT: BookletType.JO_SLIP,
  SI_VAT: BookletType.SI_VAT,
  SI_NON_VAT: BookletType.SI_NON_VAT,
  SI_CHARGE: BookletType.SI_CHARGE,
  COLLECTION: BookletType.CR,
};

const KIND_SALE_TYPE: Record<
  Exclude<ReceiptKind, "COLLECTION">,
  SaleType
> = {
  JO_RECEIPT: SaleType.JO_SLIP,
  SI_VAT: SaleType.SI_VAT,
  SI_NON_VAT: SaleType.SI_NON_VAT,
  SI_CHARGE: SaleType.SI_CHARGE,
};

/** What every issue path hands back — the numbers the counter needs. */
type IssueResult = {
  id: string;
  documentNo: string;
  changeGiven: string;
  amountPaid: string;
  /** Unsettled remainder, straight to A/R. "0.00" on an ordinary cash sale. */
  balanceDue: string;
};

export class ReceiptService {
  constructor(
    private readonly receipts: IReceiptRepository,
    private readonly booklets: IBookletRepository,
    private readonly activity: IActivityLogRepository
  ) {}

  /**
   * Everything the Receive Payment dialog opens with: the customer's name,
   * address and TIN (already on the JO — the cashier never retypes them), what
   * has been received so far, and the next number waiting on each booklet.
   */
  async getPaymentOptions(
    actor: Actor,
    jobOrderId: string
  ): Promise<ReceivePaymentOptionsDto> {
    assertCan(actor, "read", "Sale");
    const jo = await this.receipts.findJobOrder(jobOrderId);
    if (!jo) throw new NotFoundError("Job order not found.");

    const { sales, crs } = await this.receipts.listByJobOrder(jobOrderId);
    const issued = [
      ...sales.map(saleToRow),
      ...crs.map(crToRow),
    ].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));

    // What the customer has actually handed over against this JO. Collection
    // Receipts count as money received even though they are not revenue.
    //
    // A cancelled receipt contributes NOTHING — that is the whole point of
    // voiding one: the balance reopens and the counter can issue a fresh
    // receipt against this JO (docs/sales.txt §5).
    const live = <T extends { voidedAt: Date | null }>(rows: T[]) =>
      rows.filter((r) => r.voidedAt === null);
    const receivedCentavos =
      live(sales).reduce((s, r) => s + toCentavos(r.amountPaid.toString()), 0) +
      live(crs).reduce((s, r) => s + toCentavos(r.amount.toString()), 0);

    const joTotal = joTotalCentavos(jo);

    const nextNumbers = {} as Record<ReceiptKind, string | null>;
    for (const kind of Object.values(RECEIPT_KIND)) {
      nextNumbers[kind] = await this.peekNextNumber(KIND_BOOKLET[kind]);
    }

    return {
      jobOrderId: jo.id,
      joNumber: jo.joNumber,
      customer: jo.customer,
      joTotal: toAmount(joTotal),
      totalReceived: toAmount(receivedCentavos),
      balance: toAmount(Math.max(joTotal - receivedCentavos, 0)),
      nextNumbers,
      issued,
    };
  }

  /**
   * Issue a receipt against a Job Order and take the money.
   *
   * The booklet row is locked FOR UPDATE and the receipt is INSERTed in the
   * SAME transaction, so two cashiers clicking at the same instant serialise:
   * the second blocks, then gets the next number. The UNIQUE on documentNo is
   * the backstop if anything ever slips past.
   */
  async receivePayment(
    actor: Actor,
    input: ReceivePaymentInput
  ): Promise<IssueResult> {
    assertCan(actor, "create", "Sale");

    const plan = await this.planIssue(input);
    const result = await this.receipts.withTransaction((tx) =>
      this.issue(actor, plan, tx)
    );

    await this.activity.log({
      userId: actor.id,
      entityType:
        input.kind === RECEIPT_KIND.COLLECTION ? "CollectionReceipt" : "Sale",
      entityId: result.id,
      action: "receive-payment",
      payload: {
        kind: input.kind,
        documentNo: result.documentNo,
        joNumber: plan.jo.joNumber,
        amount: toAmount(plan.amount),
        // A split, and an unpaid balance, are the two things an auditor most
        // wants to see in the log.
        tender:
          plan.settled.tenders
            .map((t) => `${t.method} ${toAmount(t.amount)}`)
            .join(" + ") || "nothing received (on credit)",
        balanceDue: result.balanceDue,
      },
    });

    return result;
  }

  /**
   * Cancel or void an issued receipt (docs/sales.txt §5).
   *
   * The row is NOT deleted and the serial number is NOT reused: the receipt
   * keeps its place in the booklet so all 50 leaves stay accountable. What
   * changes is that it stops counting as money received, which reopens the Job
   * Order's balance and lets the counter issue a fresh receipt against it.
   *
   * Only a supervisor may do this — §5.1 step 6 wants the cancellation
   * initialled by someone other than the cashier who issued it.
   */
  async voidReceipt(
    actor: Actor,
    input: VoidReceiptInput
  ): Promise<{ id: string; documentNo: string }> {
    assertCan(actor, "void", "Sale");

    const isCollection = input.kind === RECEIPT_KIND.COLLECTION;
    const receipt = await this.findReceipt(input.receiptId, isCollection);

    await this.receipts.withTransaction(async (tx) => {
      const mark = {
        type: input.type,
        reason: input.reason.trim(),
        voidedById: actor.id,
      };
      if (isCollection) await this.receipts.markCrVoid(receipt.id, mark, tx);
      else await this.receipts.markSaleVoid(receipt.id, mark, tx);
    });

    await this.activity.log({
      userId: actor.id,
      entityType: isCollection ? "CollectionReceipt" : "Sale",
      entityId: receipt.id,
      action: "void-receipt",
      payload: {
        documentNo: receipt.documentNo,
        type: input.type,
        reason: input.reason.trim(),
        amount: receipt.amount,
      },
    });

    return { id: receipt.id, documentNo: receipt.documentNo };
  }

  /**
   * Replace a receipt: mark the spoiled one REPLACED and issue its corrected
   * successor, in ONE transaction. Doing both at once is what stops a
   * REPLACED receipt ever being left pointing at nothing — §5.1 step 3 wants
   * the two serials written on each other, so neither may exist alone.
   */
  async replaceReceipt(
    actor: Actor,
    input: ReplaceReceiptInput
  ): Promise<IssueResult & { replacedDocumentNo: string }> {
    assertCan(actor, "void", "Sale");
    assertCan(actor, "create", "Sale");

    const isCollection = input.kind === RECEIPT_KIND.COLLECTION;
    const old = await this.findReceipt(input.receiptId, isCollection);

    if (input.replacement.kind !== input.kind) {
      // The replacement draws from the same booklet as the receipt it
      // supersedes; crossing series would break both their sequences.
      throw new ValidationError(
        "A replacement must be the same receipt type as the one it replaces."
      );
    }

    const plan = await this.planIssue(input.replacement);
    const result = await this.receipts.withTransaction(async (tx) => {
      const issued = await this.issue(actor, plan, tx);
      const mark = {
        type: ReceiptVoidType.REPLACED,
        reason: input.reason.trim(),
        voidedById: actor.id,
        replacedById: issued.id,
      };
      if (isCollection) await this.receipts.markCrVoid(old.id, mark, tx);
      else await this.receipts.markSaleVoid(old.id, mark, tx);
      return issued;
    });

    await this.activity.log({
      userId: actor.id,
      entityType: isCollection ? "CollectionReceipt" : "Sale",
      entityId: old.id,
      action: "replace-receipt",
      payload: {
        documentNo: old.documentNo,
        replacedBy: result.documentNo,
        reason: input.reason.trim(),
      },
    });

    return { ...result, replacedDocumentNo: old.documentNo };
  }

  /** Load a receipt that is about to be cancelled, and refuse the silly cases. */
  private async findReceipt(id: string, isCollection: boolean) {
    const receipt = isCollection
      ? await this.receipts.findCrForVoid(id)
      : await this.receipts.findSaleForVoid(id);
    if (!receipt) throw new NotFoundError("Receipt not found.");
    if (receipt.voidedAt) {
      throw new ValidationError(
        `${receipt.documentNo} has already been cancelled.`
      );
    }
    return receipt;
  }

  /**
   * Everything a receipt needs worked out BEFORE the transaction opens: the
   * JO, the VAT split, the tender lines, the change. Kept out of the tx so the
   * booklet row is locked for as short a time as possible.
   */
  private async planIssue(input: ReceivePaymentInput) {
    const jo = await this.receipts.findJobOrder(input.jobOrderId);
    if (!jo) throw new NotFoundError("Job order not found.");

    const amount = toCentavos(input.amount);
    if (amount <= 0) {
      throw new ValidationError("Enter an amount greater than zero.");
    }

    // The tender lines ARE the money received: over the amount gives change,
    // under it leaves a balance in A/R, none at all is a pure credit sale.
    // A single-method payment is the same thing with one line, so there is
    // only one code path below.
    const lines = input.payments ?? [
      { method: input.method, amount: input.amount, reference: input.methodDetail },
    ];
    const settled = settleTenders(lines, amount);
    // Every kind but a Charge Invoice is a document handed over at the counter
    // in exchange for money — issuing one with nothing received is a mistake,
    // and almost always means the wrong receipt type was picked.
    if (settled.received === 0 && input.kind !== RECEIPT_KIND.SI_CHARGE) {
      throw new ValidationError(
        `Nothing was received. A sale on credit is issued as a ${RECEIPT_KIND_LABEL.SI_CHARGE}.`
      );
    }
    const header = settled.tenders.length
      ? dominantTender(settled.tenders)
      : null;

    const receivedAt = input.receivedAt ? new Date(input.receivedAt) : new Date();
    if (Number.isNaN(receivedAt.getTime())) {
      throw new ValidationError("Invalid payment date.");
    }

    return { input, jo, amount, settled, header, receivedAt };
  }

  /**
   * Insert the receipt, inside the caller's transaction.
   *
   * The booklet row is locked FOR UPDATE and the receipt is INSERTed in the
   * SAME transaction, so two cashiers clicking at the same instant serialise:
   * the second blocks, then gets the next number. The UNIQUE on documentNo is
   * the backstop if anything ever slips past.
   */
  private async issue(
    actor: Actor,
    plan: Awaited<ReturnType<ReceiptService["planIssue"]>>,
    tx: DbTx
  ): Promise<IssueResult> {
    const { input, jo, amount, settled, header, receivedAt } = plan;

    const documentNo = await this.allocateNumber(KIND_BOOKLET[input.kind], tx);
    const bookletId = documentNo.bookletId;

    const billedTo = {
      billedToName: jo.customer.name,
      billedToAddress: jo.customer.address,
      billedToTin: jo.customer.tin,
    };

    const paymentLines = settled.tenders.map((t, seq) => ({
      method: t.method,
      amount: toAmount(t.amount),
      reference: t.reference,
      seq,
    }));

    const counter = {
      cashTendered:
        settled.cashTendered === null ? null : toAmount(settled.cashTendered),
      changeGiven: toAmount(settled.changeGiven),
      payments: paymentLines,
      notes: input.notes?.trim() || null,
      createdById: actor.id,
      ...billedTo,
    };

    const money = {
      changeGiven: toAmount(settled.changeGiven),
      amountPaid: toAmount(settled.applied),
      balanceDue: toAmount(settled.balanceDue),
    };

    if (input.kind === RECEIPT_KIND.COLLECTION) {
      const created = await this.receipts.createCr(
        {
          crNumber: documentNo.value,
          bookletId,
          customerId: jo.customer.id,
          jobOrderId: jo.id,
          // A Collection Receipt acknowledges what came in — it has no
          // separate "document amount" to be short of.
          amount: toAmount(settled.applied),
          method: header?.method ?? PaymentMethod.CASH,
          methodDetail: header?.reference ?? null,
          receivedAt,
          ...counter,
        },
        tx
      );
      return { id: created.id, documentNo: documentNo.value, ...money };
    }

    const saleType = KIND_SALE_TYPE[input.kind];
    // VAT is backed OUT of the gross, exactly as the legacy sheet does — and
    // off the FULL invoice amount, not off what was received. Selling on
    // credit does not defer the tax.
    const vat = splitVat(amount, saleType);

    const created = await this.receipts.createSale(
      {
        documentNo: documentNo.value,
        bookletId,
        type: saleType,
        customerId: jo.customer.id,
        jobOrderId: jo.id,
        saleDate: receivedAt,
        amount: toAmount(vat.amount),
        vatableSales: toAmount(vat.vatableSales),
        vatAmount: toAmount(vat.vatAmount),
        amountPaid: toAmount(settled.applied),
        paymentStatus: paymentStatusOf(settled.applied, amount),
        paymentMethod: header?.method ?? null,
        methodDetail: header?.reference ?? null,
        ...counter,
      },
      tx
    );
    return { id: created.id, documentNo: documentNo.value, ...money };
  }

  /** The day's receipts — the legacy daily sales log. */
  async listDay(
    actor: Actor,
    filters: ReceiptListFilters
  ): Promise<ReceiptListPageDto> {
    assertCan(actor, "read", "Sale");
    const { from, to } = dayRange(filters.date);
    const { sales, crs } = await this.receipts.listByDay({
      from,
      to,
      q: filters.q,
    });
    const rows = [...sales.map(saleToRow), ...crs.map(crToRow)].sort((a, b) =>
      b.receivedAt.localeCompare(a.receivedAt)
    );
    return { rows, nextCursor: null };
  }

  /**
   * The day's totals, split VAT / Non-VAT for BIR.
   *
   * Collection Receipts are reported SEPARATELY and excluded from gross sales:
   * the revenue was already booked by the invoice they collect against, so
   * counting them again would overstate sales.
   */
  async getDailySummary(
    actor: Actor,
    date?: string
  ): Promise<DailySalesSummaryDto> {
    assertCan(actor, "read", "Sale");
    const { from, to, key } = dayRange(date);
    const all = await this.receipts.listByDay({ from, to });

    // Cancelled receipts are listed in the day log but never TOTALLED: a
    // voided invoice is not a sale, and counting it would overstate the day's
    // gross and the VAT due on it.
    const sales = all.sales.filter((s) => s.voidedAt === null);
    const crs = all.crs.filter((c) => c.voidedAt === null);

    const bucket = (type: SaleType) => sales.filter((s) => s.type === type);
    const sum = (rows: { amount: unknown }[]) =>
      rows.reduce((t, r) => t + toCentavos(String(r.amount)), 0);

    const vatRows = bucket(SaleType.SI_VAT);
    const nonVatRows = bucket(SaleType.SI_NON_VAT);
    const chargeRows = bucket(SaleType.SI_CHARGE);
    const joRows = bucket(SaleType.JO_SLIP);

    // A Charge Invoice books revenue at point of sale (docs/sales.txt §3.1.3),
    // so it belongs in gross sales even though the money has not arrived. The
    // Collection Receipt that settles it later is excluded instead — that is
    // what stops the same peso being counted twice.
    const grossSales =
      sum(vatRows) + sum(nonVatRows) + sum(chargeRows) + sum(joRows);

    // What is still owed on today's receipts, whatever kind they are.
    const owed = sales
      .map((s) => toCentavos(s.amount.toString()) - toCentavos(s.amountPaid.toString()))
      .filter((d) => d > 0);

    const vatOf = (rows: typeof vatRows) => ({
      vatableSales: toAmount(
        rows.reduce((t, r) => t + toCentavos(r.vatableSales.toString()), 0)
      ),
      vatAmount: toAmount(
        rows.reduce((t, r) => t + toCentavos(r.vatAmount.toString()), 0)
      ),
    });

    const pendingAudit =
      sales.filter((s) => s.auditEntries.length === 0).length +
      crs.filter((c) => c.auditEntries.length === 0).length;

    return {
      date: key,
      vat: {
        count: vatRows.length,
        gross: toAmount(sum(vatRows)),
        ...vatOf(vatRows),
      },
      nonVat: { count: nonVatRows.length, gross: toAmount(sum(nonVatRows)) },
      charge: {
        count: chargeRows.length,
        gross: toAmount(sum(chargeRows)),
        ...vatOf(chargeRows),
      },
      joReceipts: { count: joRows.length, gross: toAmount(sum(joRows)) },
      collections: { count: crs.length, gross: toAmount(sum(crs)) },
      grossSales: toAmount(grossSales),
      receivables: {
        count: owed.length,
        amount: toAmount(owed.reduce((t, d) => t + d, 0)),
      },
      pendingAudit,
    };
  }

  /** The auditor's sign-off — legacy verified_by / verified_at. */
  async auditReceipt(
    actor: Actor,
    input: AuditReceiptInput
  ): Promise<{ id: string }> {
    assertCan(actor, "audit", "Sale");

    if (input.saleId && !(await this.receipts.findSale(input.saleId))) {
      throw new NotFoundError("Receipt not found.");
    }
    if (
      input.collectionReceiptId &&
      !(await this.receipts.findCr(input.collectionReceiptId))
    ) {
      throw new NotFoundError("Collection receipt not found.");
    }

    const entry = await this.receipts.createAuditEntry({
      saleId: input.saleId ?? null,
      collectionReceiptId: input.collectionReceiptId ?? null,
      status: input.status,
      flagType: input.flagType ?? null,
      remarks: input.remarks?.trim() || null,
      auditorId: actor.id,
    });

    await this.activity.log({
      userId: actor.id,
      entityType: input.saleId ? "Sale" : "CollectionReceipt",
      entityId: (input.saleId ?? input.collectionReceiptId)!,
      action: "audit",
      payload: { status: input.status, flagType: input.flagType ?? "" },
    });
    return entry;
  }

  // ——— numbering ———

  /** Read-only peek for the dialog: does not consume the number. */
  private async peekNextNumber(type: BookletType): Promise<string | null> {
    const active = await this.booklets.list({ type, status: "ACTIVE" });
    const booklet = active[0];
    if (!booklet || booklet.nextNumber > booklet.seriesEnd) return null;
    return formatDocumentNo(booklet.prefix, booklet.nextNumber);
  }

  /** Consume the next number from the ACTIVE booklet, inside the caller's tx. */
  private async allocateNumber(
    type: BookletType,
    tx: DbTx
  ): Promise<{ value: string; bookletId: string }> {
    const booklet = await this.booklets.lockActiveBooklet(type, tx);
    if (!booklet) {
      throw new ValidationError(
        `No active booklet for ${RECEIPT_KIND_LABEL[kindOfBooklet(type)]}. Register and approve one under Sales Audit Maintenance.`
      );
    }
    if (booklet.nextNumber > booklet.seriesEnd) {
      throw new ValidationError(
        "The active booklet is used up. Activate the next one under Sales Audit Maintenance."
      );
    }
    const value = formatDocumentNo(booklet.prefix, booklet.nextNumber);
    await this.booklets.consumeNumber(
      booklet.id,
      booklet.nextNumber,
      booklet.seriesEnd,
      tx
    );
    return { value, bookletId: booklet.id };
  }
}

// ——— helpers ———

function kindOfBooklet(type: BookletType): ReceiptKind {
  const found = (Object.keys(KIND_BOOKLET) as ReceiptKind[]).find(
    (k) => KIND_BOOKLET[k] === type
  );
  return found ?? RECEIPT_KIND.SI_VAT;
}

/** JO total, falling back to the sum of its line items when total is unset. */
function joTotalCentavos(jo: JoForReceiptRecord): number {
  const header = toCentavos(jo.total.toString());
  if (header > 0) return header;
  return jo.items.reduce((t, i) => t + toCentavos(i.lineTotal.toString()), 0);
}

/** Local-day window [00:00, next 00:00) for a YYYY-MM-DD key. */
function dayRange(date?: string): { from: Date; to: Date; key: string } {
  const base = date ? new Date(`${date}T00:00:00`) : new Date();
  if (Number.isNaN(base.getTime())) {
    throw new ValidationError("Invalid date.");
  }
  const from = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  const to = new Date(from.getTime() + 86_400_000);
  const key = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, "0")}-${String(from.getDate()).padStart(2, "0")}`;
  return { from, to, key };
}

/** Prisma Decimal → the string form every DTO carries money in. */
function toPaymentLine(p: {
  method: PaymentMethod;
  amount: unknown;
  reference: string | null;
}): PaymentLineDto {
  return {
    method: p.method,
    amount: String(p.amount),
    reference: p.reference,
  };
}

const SALE_TYPE_KIND: Record<SaleType, ReceiptKind> = {
  [SaleType.SI_VAT]: RECEIPT_KIND.SI_VAT,
  [SaleType.SI_NON_VAT]: RECEIPT_KIND.SI_NON_VAT,
  [SaleType.SI_CHARGE]: RECEIPT_KIND.SI_CHARGE,
  [SaleType.JO_SLIP]: RECEIPT_KIND.JO_RECEIPT,
};

function saleToRow(s: SaleRecord): ReceiptRowDto {
  const audit = s.auditEntries[0];
  const kind = SALE_TYPE_KIND[s.type];
  return {
    id: s.id,
    kind,
    kindLabel: RECEIPT_KIND_LABEL[kind],
    documentNo: s.documentNo,
    customerName: s.billedToName ?? s.customer.name,
    joNumber: s.jobOrder?.joNumber ?? null,
    amount: s.amount.toString(),
    vatableSales: s.vatableSales.toString(),
    vatAmount: s.vatAmount.toString(),
    amountPaid: s.amountPaid.toString(),
    balanceDue: toAmount(
      Math.max(
        toCentavos(s.amount.toString()) - toCentavos(s.amountPaid.toString()),
        0
      )
    ),
    paymentStatus: s.paymentStatus,
    cashTendered: s.cashTendered?.toString() ?? null,
    changeGiven: s.changeGiven.toString(),
    method: s.paymentMethod,
    methodDetail: s.methodDetail,
    payments: s.payments.map(toPaymentLine),
    receivedAt: s.saleDate.toISOString(),
    createdByName: s.createdBy.name,
    auditStatus: audit?.status ?? null,
    auditorName: audit?.auditor.name ?? null,
    auditRemarks: audit?.remarks ?? null,
    voidType: s.voidType,
    voidReason: s.voidReason,
    voidedAt: s.voidedAt?.toISOString() ?? null,
    voidedByName: s.voidedBy?.name ?? null,
    replacedByDocumentNo: s.replacedBy?.documentNo ?? null,
    replacesDocumentNo: s.replaces?.documentNo ?? null,
  };
}

function crToRow(c: CrRecord): ReceiptRowDto {
  const audit = c.auditEntries[0];
  return {
    id: c.id,
    kind: RECEIPT_KIND.COLLECTION,
    kindLabel: RECEIPT_KIND_LABEL.COLLECTION,
    documentNo: c.crNumber,
    customerName: c.billedToName ?? c.customer.name,
    joNumber: c.jobOrder?.joNumber ?? null,
    amount: c.amount.toString(),
    // A collection is not revenue — it carries no VAT split.
    vatableSales: "0.00",
    vatAmount: "0.00",
    amountPaid: c.amount.toString(),
    // A collection acknowledges what came in — it is never itself unpaid.
    balanceDue: "0.00",
    paymentStatus: PaymentStatus.PAID,
    cashTendered: c.cashTendered?.toString() ?? null,
    changeGiven: c.changeGiven.toString(),
    method: c.method,
    methodDetail: c.methodDetail,
    payments: c.payments.map(toPaymentLine),
    receivedAt: c.receivedAt.toISOString(),
    createdByName: c.createdBy.name,
    auditStatus: audit?.status ?? null,
    auditorName: audit?.auditor.name ?? null,
    auditRemarks: audit?.remarks ?? null,
    voidType: c.voidType,
    voidReason: c.voidReason,
    voidedAt: c.voidedAt?.toISOString() ?? null,
    voidedByName: c.voidedBy?.name ?? null,
    replacedByDocumentNo: c.replacedBy?.crNumber ?? null,
    replacesDocumentNo: c.replaces?.crNumber ?? null,
  };
}

// Re-exported so callers don't reach into the enums for the common case.
export { AuditEntryStatus, PaymentMethod };

let instance: ReceiptService | undefined;

export function getReceiptService(): ReceiptService {
  instance ??= new ReceiptService(
    new PrismaReceiptRepository(),
    new PrismaBookletRepository(),
    new PrismaActivityLogRepository()
  );
  return instance;
}
