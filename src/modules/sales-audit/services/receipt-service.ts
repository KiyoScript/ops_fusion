import { assertCan } from "@/lib/ability";
import type { Actor } from "@/lib/authz";
import { NotFoundError, ValidationError } from "@/lib/errors";
import {
  AuditEntryStatus,
  BookletType,
  PaymentMethod,
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
  type ReceiptKind,
  type ReceiptListFilters,
  type ReceiptListPageDto,
  type ReceiptRowDto,
  type ReceivePaymentInput,
  type ReceivePaymentOptionsDto,
} from "../schemas/receipt";
import { formatDocumentNo } from "./booklet-service";
import { computeChange, splitVat, toAmount, toCentavos } from "./money";

// Which booklet a receipt kind draws its number from, and — for the three
// revenue kinds — which SaleType it is filed as.
const KIND_BOOKLET: Record<ReceiptKind, BookletType> = {
  JO_RECEIPT: BookletType.JO_SLIP,
  SI_VAT: BookletType.SI_VAT,
  SI_NON_VAT: BookletType.SI_NON_VAT,
  COLLECTION: BookletType.CR,
};

const KIND_SALE_TYPE: Record<
  Exclude<ReceiptKind, "COLLECTION">,
  SaleType
> = {
  JO_RECEIPT: SaleType.JO_SLIP,
  SI_VAT: SaleType.SI_VAT,
  SI_NON_VAT: SaleType.SI_NON_VAT,
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
    const receivedCentavos =
      sales.reduce((s, r) => s + toCentavos(r.amountPaid.toString()), 0) +
      crs.reduce((s, r) => s + toCentavos(r.amount.toString()), 0);

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
  ): Promise<{ id: string; documentNo: string; changeGiven: string }> {
    assertCan(actor, "create", "Sale");

    const jo = await this.receipts.findJobOrder(input.jobOrderId);
    if (!jo) throw new NotFoundError("Job order not found.");

    const amount = toCentavos(input.amount);
    if (amount <= 0) {
      throw new ValidationError("Enter an amount greater than zero.");
    }

    const tendered =
      input.cashTendered && input.cashTendered.trim() !== ""
        ? toCentavos(input.cashTendered)
        : null;
    // Cash must cover the receipt; a cheque or transfer gives no change.
    const changeGiven = computeChange(tendered, amount);

    const receivedAt = input.receivedAt ? new Date(input.receivedAt) : new Date();
    if (Number.isNaN(receivedAt.getTime())) {
      throw new ValidationError("Invalid payment date.");
    }

    const bookletType = KIND_BOOKLET[input.kind];
    const isCollection = input.kind === RECEIPT_KIND.COLLECTION;

    const result = await this.receipts.withTransaction(async (tx) => {
      const documentNo = await this.allocateNumber(bookletType, tx);
      const bookletId = documentNo.bookletId;

      const billedTo = {
        billedToName: jo.customer.name,
        billedToAddress: jo.customer.address,
        billedToTin: jo.customer.tin,
      };

      if (input.kind === RECEIPT_KIND.COLLECTION) {
        const created = await this.receipts.createCr(
          {
            crNumber: documentNo.value,
            bookletId,
            customerId: jo.customer.id,
            jobOrderId: jo.id,
            amount: toAmount(amount),
            method: input.method,
            methodDetail: input.methodDetail?.trim() || null,
            cashTendered: tendered === null ? null : toAmount(tendered),
            changeGiven: toAmount(changeGiven),
            ...billedTo,
            receivedAt,
            notes: input.notes?.trim() || null,
            createdById: actor.id,
          },
          tx
        );
        return { id: created.id, documentNo: documentNo.value };
      }

      const saleType = KIND_SALE_TYPE[input.kind];
      // VAT is backed OUT of the gross, exactly as the legacy sheet does.
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
          amountPaid: toAmount(amount),
          cashTendered: tendered === null ? null : toAmount(tendered),
          changeGiven: toAmount(changeGiven),
          paymentMethod: input.method,
          methodDetail: input.methodDetail?.trim() || null,
          ...billedTo,
          notes: input.notes?.trim() || null,
          createdById: actor.id,
        },
        tx
      );
      return { id: created.id, documentNo: documentNo.value };
    });

    await this.activity.log({
      userId: actor.id,
      entityType: isCollection ? "CollectionReceipt" : "Sale",
      entityId: result.id,
      action: "receive-payment",
      payload: {
        kind: input.kind,
        documentNo: result.documentNo,
        joNumber: jo.joNumber,
        amount: toAmount(amount),
      },
    });

    return { ...result, changeGiven: toAmount(changeGiven) };
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
    const { sales, crs } = await this.receipts.listByDay({ from, to });

    const bucket = (type: SaleType) => sales.filter((s) => s.type === type);
    const sum = (rows: { amount: unknown }[]) =>
      rows.reduce((t, r) => t + toCentavos(String(r.amount)), 0);

    const vatRows = bucket(SaleType.SI_VAT);
    const nonVatRows = bucket(SaleType.SI_NON_VAT);
    const joRows = bucket(SaleType.JO_SLIP);

    const grossSales = sum(vatRows) + sum(nonVatRows) + sum(joRows);
    const pendingAudit =
      sales.filter((s) => s.auditEntries.length === 0).length +
      crs.filter((c) => c.auditEntries.length === 0).length;

    return {
      date: key,
      vat: {
        count: vatRows.length,
        gross: toAmount(sum(vatRows)),
        vatableSales: toAmount(
          vatRows.reduce((t, r) => t + toCentavos(r.vatableSales.toString()), 0)
        ),
        vatAmount: toAmount(
          vatRows.reduce((t, r) => t + toCentavos(r.vatAmount.toString()), 0)
        ),
      },
      nonVat: { count: nonVatRows.length, gross: toAmount(sum(nonVatRows)) },
      joReceipts: { count: joRows.length, gross: toAmount(sum(joRows)) },
      collections: { count: crs.length, gross: toAmount(sum(crs)) },
      grossSales: toAmount(grossSales),
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

const SALE_TYPE_KIND: Record<SaleType, ReceiptKind> = {
  [SaleType.SI_VAT]: RECEIPT_KIND.SI_VAT,
  [SaleType.SI_NON_VAT]: RECEIPT_KIND.SI_NON_VAT,
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
    cashTendered: s.cashTendered?.toString() ?? null,
    changeGiven: s.changeGiven.toString(),
    method: s.paymentMethod,
    methodDetail: s.methodDetail,
    receivedAt: s.saleDate.toISOString(),
    createdByName: s.createdBy.name,
    auditStatus: audit?.status ?? null,
    auditorName: audit?.auditor.name ?? null,
    auditRemarks: audit?.remarks ?? null,
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
    cashTendered: c.cashTendered?.toString() ?? null,
    changeGiven: c.changeGiven.toString(),
    method: c.method,
    methodDetail: c.methodDetail,
    receivedAt: c.receivedAt.toISOString(),
    createdByName: c.createdBy.name,
    auditStatus: audit?.status ?? null,
    auditorName: audit?.auditor.name ?? null,
    auditRemarks: audit?.remarks ?? null,
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
