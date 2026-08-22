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
import { resolveEnabledModules } from "@/lib/modules";
import type { IActivityLogRepository } from "@/modules/shared/repositories/activity-log-repository";
import { PrismaActivityLogRepository } from "@/modules/shared/repositories/activity-log-repository";
import type { IModuleFlagRepository } from "@/modules/shared/repositories/module-flag-repository";
import { PrismaModuleFlagRepository } from "@/modules/shared/repositories/module-flag-repository";
import type { ICustomerRepository } from "@/modules/shared/repositories/customer-repository";
import { PrismaCustomerRepository } from "@/modules/shared/repositories/customer-repository";
import type { DbTx } from "@/modules/shared/repositories/types";
import type { IBookletRepository } from "../repositories/booklet-repository";
import { PrismaBookletRepository } from "../repositories/booklet-repository";
import type { ICreditRepository } from "../repositories/credit-repository";
import { PrismaCreditRepository } from "../repositories/credit-repository";
import type {
  AllocationCreateData,
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
  type CollectFromCustomerInput,
  type CollectOptionsDto,
  type CollectResultDto,
  type CustomerCreditDto,
  type DailySalesSummaryDto,
  type SalesGranularity,
  type SalesReportDto,
  type SalesReportFilters,
  type JobOrderHistoryDto,
  type OpenInvoiceDto,
  type PaymentLineDto,
  type ReceiptAvailabilityDto,
  type ReceiptKind,
  type ReceiptListFilters,
  type ReceiptListPageDto,
  type ReceiptRowDto,
  type ReceivePaymentInput,
  type ReceivePaymentOptionsDto,
  type VoidReceiptInput,
} from "../schemas/receipt";
import { formatDocumentNo } from "./booklet-service";
import {
  computeWithholding,
  dominantTender,
  joCollectedCentavos,
  joTotalCentavos,
  openBalanceOf as sharedOpenBalanceOf,
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

/** The revenue documents. A collection is not one of these. */
const INVOICE_KINDS: ReceiptKind[] = [
  RECEIPT_KIND.SI_VAT,
  RECEIPT_KIND.SI_NON_VAT,
  RECEIPT_KIND.SI_CHARGE,
];

/** What every issue path hands back — the numbers the counter needs. */
type IssueResult = {
  id: string;
  /** Null when a collection was recorded without printing a CR. */
  documentNo: string | null;
  changeGiven: string;
  amountPaid: string;
  /** Unsettled remainder, straight to A/R. "0.00" on an ordinary cash sale. */
  balanceDue: string;
};

/**
 * A job order's money position, in centavos.
 *
 * The whole point of this type is that `unbilled` and `outstanding` are
 * DIFFERENT numbers. The old code carried one "balance" (job total less cash
 * received) and used it for both jobs, which is why a job already covered by a
 * charge invoice — billed in full, collected not at all — still looked wide
 * open and invited a second invoice for the same money.
 */
type JoPosition = {
  joTotal: number;
  /** Face value of every live receipt raised against the job. */
  billed: number;
  /** Money actually in: paid at the counter, plus every collection since. */
  collected: number;
  /** Job total less billed — how much may still be INVOICED. */
  unbilled: number;
  /** Billed but not collected — A/R, how much may still be COLLECTED. */
  outstanding: number;
  hasInvoice: boolean;
  hasJoReceipt: boolean;
  /** The live invoices with money still owed on them, oldest first. */
  openInvoices: { sale: SaleRecord; openBalance: number }[];
};

export class ReceiptService {
  constructor(
    private readonly receipts: IReceiptRepository,
    private readonly booklets: IBookletRepository,
    private readonly activity: IActivityLogRepository,
    private readonly flags: IModuleFlagRepository,
    private readonly credits: ICreditRepository,
    private readonly customers: ICustomerRepository
  ) {}

  /** Is a feature module switched on? Resolved from overrides + coded default. */
  private async moduleEnabled(key: "credit-control" | "receivables") {
    const rows = await this.flags.listOverrides();
    return resolveEnabledModules(new Map(rows.map((r) => [r.key, r.enabled]))).has(key);
  }

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

    const position = positionOf(jo, sales, crs);
    const creditEnabled = await this.moduleEnabled("credit-control");
    const credit = await this.creditPositionOf(jo, creditEnabled);

    const nextNumbers = {} as Record<ReceiptKind, string | null>;
    for (const kind of Object.values(RECEIPT_KIND)) {
      nextNumbers[kind] = await this.peekNextNumber(KIND_BOOKLET[kind]);
    }

    const availability = availabilityOf(position, credit, nextNumbers);

    return {
      jobOrderId: jo.id,
      joNumber: jo.joNumber,
      customer: {
        id: jo.customer.id,
        name: jo.customer.name,
        address: jo.customer.address,
        tin: jo.customer.tin,
        vatRegistered: jo.customer.vatRegistered,
      },
      joTotal: toAmount(position.joTotal),
      agreedDownpayment: agreedDownpaymentOf(jo, position.joTotal),
      totalReceived: toAmount(position.collected),
      unbilled: toAmount(position.unbilled),
      outstanding: toAmount(position.outstanding),
      availability,
      recommended: recommendKind(position, availability, jo.customer.vatRegistered),
      openInvoices: position.openInvoices.map(({ sale, openBalance }) =>
        toOpenInvoice(sale, openBalance, jo.customer)
      ),
      credit,
      nextNumbers,
      issued,
    };
  }

  /** The customer's credit standing — their whole A/R, not just this job. */
  private async creditPositionOf(jo: JoForReceiptRecord, enabled: boolean) {
    const rows = await this.receipts.listReceivables(jo.customer.id);
    const customerOutstanding = rows.reduce(
      (t, r) => t + openBalanceOf(r.amount, r.amountPaid, r.settledAmount),
      0
    );
    const limit =
      jo.customer.creditLimit === null
        ? null
        : toCentavos(jo.customer.creditLimit.toString());
    return {
      enabled,
      termDays: jo.customer.creditTermDays,
      limit: limit === null ? null : toAmount(limit),
      customerOutstanding: toAmount(customerOutstanding),
      available: limit === null ? null : toAmount(limit - customerOutstanding),
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
        documentNo: result.documentNo ?? "(no document issued)",
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
  ): Promise<{ id: string; documentNo: string | null }> {
    assertCan(actor, "void", "Sale");

    const isCollection = input.kind === RECEIPT_KIND.COLLECTION;
    const receipt = await this.findReceipt(input.receiptId, isCollection);

    if (!isCollection) {
      // An invoice that has already been collected against cannot be pulled
      // out from under those collections — the money would still be recorded
      // as paying for a document that no longer exists. Cancel the collections
      // first, which reopens the receivable, then cancel the invoice.
      const collected = await this.receipts.countAllocationsForSale(receipt.id);
      if (collected > 0) {
        throw new ValidationError(
          `${receipt.documentNo} has ${collected} collection${collected === 1 ? "" : "s"} ` +
            `applied to it. Cancel those first — cancelling this invoice now would leave that money owed against nothing.`
        );
      }
    } else {
      // Cancelling a collection takes back the credit its overpayment created.
      // Once some of that credit has already paid down another invoice, taking
      // it back would leave that invoice settled by money that no longer
      // exists — so the collection that spent it has to be undone first.
      const spent = await this.credits.spentFromCreditsCreatedBy(receipt.id);
      if (spent > 0) {
        throw new ValidationError(
          `The credit this payment left on the account has already been spent on ${spent} later payment${spent === 1 ? "" : "s"}. Cancel those first.`
        );
      }
    }

    await this.receipts.withTransaction(async (tx) => {
      const mark = {
        // Always CANCELLED: that is the one word the shop writes on the face
        // of a leaf. What distinguishes cancellations from one another is the
        // successor's serial (§5.1 step 3), never the mark.
        type: ReceiptVoidType.CANCELLED,
        reason: input.reason.trim(),
        voidedById: actor.id,
      };
      if (isCollection) {
        // Undo what this collection paid down BEFORE marking it cancelled, so
        // the invoices it touched go back to being owed. Same transaction:
        // a half-reversed collection would silently understate A/R.
        await this.receipts.reverseAllocations(receipt.id, tx);
        // …and undo what it did to customer credit: any credit it spent goes
        // back on the account, any credit it created comes off.
        await this.credits.reverseForCollection(receipt.id, tx);
        await this.receipts.markCrVoid(receipt.id, mark, tx);
      } else {
        await this.receipts.markSaleVoid(receipt.id, mark, tx);
      }
    });

    await this.activity.log({
      userId: actor.id,
      entityType: isCollection ? "CollectionReceipt" : "Sale",
      entityId: receipt.id,
      action: "void-receipt",
      payload: {
        documentNo: receipt.documentNo ?? "(no document issued)",
        type: ReceiptVoidType.CANCELLED,
        reason: input.reason.trim(),
        amount: receipt.amount,
      },
    });

    return { id: receipt.id, documentNo: receipt.documentNo };
  }

  /** Load a receipt that is about to be cancelled, and refuse the silly cases. */
  private async findReceipt(id: string, isCollection: boolean) {
    const receipt = isCollection
      ? await this.receipts.findCrForVoid(id)
      : await this.receipts.findSaleForVoid(id);
    if (!receipt) throw new NotFoundError("Receipt not found.");
    if (receipt.voidedAt) {
      throw new ValidationError(
        `${receipt.documentNo ?? "This payment"} has already been cancelled.`
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

    const { sales, crs } = await this.receipts.listByJobOrder(input.jobOrderId);
    const position = positionOf(jo, sales, crs);

    const creditEnabled = await this.moduleEnabled("credit-control");
    const credit = await this.creditPositionOf(jo, creditEnabled);

    assertIssuable({ kind: input.kind, amount, position, credit });

    // The tender lines ARE the money received: over the amount gives change,
    // under it is refused outright below. A single-method payment is the same
    // thing with one line, so there is only one code path.
    const lines = input.payments ?? [
      { method: input.method, amount: input.amount, reference: input.methodDetail },
    ];
    const settled = settleTenders(lines, amount);

    if (input.kind === RECEIPT_KIND.SI_CHARGE) {
      // A Charge Invoice IS the "no money yet" document. Taking cash against
      // one at the counter means it was the wrong choice — that sale is an
      // ordinary invoice, and the two must not be blurred or the A/R ledger
      // stops meaning anything.
      if (settled.received > 0) {
        throw new ValidationError(
          `A ${RECEIPT_KIND_LABEL.SI_CHARGE} records a sale on credit — nothing is received against it. ` +
            `Issue a ${RECEIPT_KIND_LABEL.SI_VAT} or ${RECEIPT_KIND_LABEL.SI_NON_VAT} for what was actually paid.`
        );
      }
    } else if (
      input.kind !== RECEIPT_KIND.JO_RECEIPT &&
      settled.balanceDue > 0
    ) {
      // A Sales Invoice is handed over in exchange for money and must be
      // covered in full: short payment is not a partial invoice, it is a
      // smaller invoice for what was paid.
      //
      // A JO slip is exempt, because the shop genuinely sells on utang across
      // the counter without raising a Charge Invoice. Its balance opens a
      // receivable like any other, and is aged and chased the same way.
      throw new ValidationError(
        `${toAmount(settled.received)} was received against a ${toAmount(amount)} ` +
          `${RECEIPT_KIND_LABEL[input.kind]}. Issue it for ${toAmount(settled.received)} instead, ` +
          `or put the balance on credit with a ${RECEIPT_KIND_LABEL.SI_CHARGE}.`
      );
    }

    // A JO slip left part-paid is credit extended, so it faces the same
    // ceiling a Charge Invoice does — on the BALANCE, not on the face value.
    // Without this a customer at their limit could take unlimited utang by
    // paying ₱1 on each slip.
    if (
      input.kind === RECEIPT_KIND.JO_RECEIPT &&
      settled.balanceDue > 0 &&
      credit.enabled &&
      credit.limit !== null
    ) {
      const available =
        toCentavos(credit.limit) - toCentavos(credit.customerOutstanding);
      if (settled.balanceDue > available) {
        throw new ValidationError(
          `${toAmount(settled.balanceDue)} left on utang would put this customer past their ${credit.limit} limit — ` +
            `${credit.customerOutstanding} is already outstanding, leaving ${toAmount(Math.max(available, 0))} available.`
        );
      }
    }

    const header = settled.tenders.length
      ? dominantTender(settled.tenders)
      : null;

    const receivedAt = input.receivedAt ? new Date(input.receivedAt) : new Date();
    if (Number.isNaN(receivedAt.getTime())) {
      throw new ValidationError("Invalid payment date.");
    }

    // Terms are frozen onto the invoice at issue — see sale.prisma. Anything
    // that leaves money owing falls due: a Charge Invoice always, and a JO slip
    // whenever it was only part-paid. A receivable with no due date can never
    // be overdue, so it would sit in CURRENT forever.
    const opensCredit =
      input.kind === RECEIPT_KIND.SI_CHARGE ||
      (input.kind === RECEIPT_KIND.JO_RECEIPT && settled.balanceDue > 0);
    const dueDate =
      opensCredit &&
      creditEnabled &&
      jo.customer.creditTermDays !== null
        ? new Date(
            receivedAt.getTime() + jo.customer.creditTermDays * 86_400_000
          )
        : null;

    const allocations =
      input.kind === RECEIPT_KIND.COLLECTION
        ? planAllocations(
            position.openInvoices.map(({ sale, openBalance }) => ({
              id: sale.id,
              documentNo: sale.documentNo,
              openBalance,
            })),
            settled.applied,
            input.allocations
          )
        : [];

    return {
      input,
      jo,
      amount,
      settled,
      header,
      receivedAt,
      dueDate,
      allocations,
    };
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
    const { input, jo, amount, settled, header, receivedAt, dueDate } = plan;

    // A collection the customer declined a receipt for consumes NO booklet
    // number — that is the whole point of the toggle. Every other kind is a
    // document by definition and always draws its next serial.
    const undocumented =
      input.kind === RECEIPT_KIND.COLLECTION && input.issueDocument === false;
    const documentNo = undocumented
      ? null
      : await this.allocateNumber(KIND_BOOKLET[input.kind], tx);
    const bookletId = documentNo?.bookletId ?? null;

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
          crNumber: documentNo?.value ?? null,
          documentIssued: !undocumented,
          bookletId,
          customerId: jo.customer.id,
          jobOrderId: jo.id,
          // A Collection Receipt acknowledges what came in — it has no
          // separate "document amount" to be short of.
          amount: toAmount(settled.applied),
          method: header?.method ?? PaymentMethod.CASH,
          methodDetail: header?.reference ?? null,
          receivedAt,
          // Writing these closes the receivable: each one bumps its invoice's
          // settledAmount in this same transaction.
          allocations: plan.allocations,
          ...counter,
        },
        tx
      );
      return { id: created.id, documentNo: documentNo?.value ?? null, ...money };
    }

    const saleType = KIND_SALE_TYPE[input.kind];
    // VAT is backed OUT of the gross, exactly as the legacy sheet does — and
    // off the FULL invoice amount, not off what was received. Selling on
    // credit does not defer the tax.
    const vat = splitVat(amount, saleType);

    // Unreachable — only a collection may be undocumented — but the compiler
    // cannot know that, and a silent `!` here would be the sort of thing that
    // bites when a fifth receipt kind is added.
    if (!documentNo) {
      throw new ValidationError(
        `A ${RECEIPT_KIND_LABEL[input.kind]} is always issued as a numbered document.`
      );
    }

    const created = await this.receipts.createSale(
      {
        documentNo: documentNo.value,
        bookletId,
        type: saleType,
        customerId: jo.customer.id,
        jobOrderId: jo.id,
        saleDate: receivedAt,
        dueDate,
        amount: toAmount(vat.amount),
        vatableSales: toAmount(vat.vatableSales),
        vatAmount: toAmount(vat.vatAmount),
        amountPaid: toAmount(settled.applied),
        paymentStatus: paymentStatusOf(settled.applied, amount),
        paymentMethod: header?.method ?? null,
        methodDetail: header?.reference ?? null,
        // Only a JO slip can be a downpayment. Setting it on an invoice would
        // be meaningless and would quietly drop that invoice out of revenue.
        isDownpayment:
          saleType === SaleType.JO_SLIP ? input.isDownpayment === true : false,
        ...counter,
      },
      tx
    );
    return { id: created.id, documentNo: documentNo.value, ...money };
  }

  // ——— customer-level collection (the QuickBooks "Receive Payment") ———

  /** Everything the Collect dialog opens with: what they owe, what we hold. */
  async getCollectOptions(
    actor: Actor,
    customerId: string
  ): Promise<CollectOptionsDto> {
    assertCan(actor, "read", "Sale");
    const customer = await this.customers.findById(customerId);
    if (!customer) throw new NotFoundError("Customer not found.");

    const open = await this.openInvoicesFor(customerId);
    const credits = await this.credits.listOpen(customerId);

    return {
      customerId: customer.id,
      customerName: customer.name,
      customerAddress: customer.address,
      customerTin: customer.tin,
      invoices: open.map((i) => i.dto),
      totalOutstanding: toAmount(
        open.reduce((t, i) => t + i.openBalance, 0)
      ),
      credits: credits.map(toCreditDto),
      creditAvailable: toAmount(
        credits.reduce((t, c) => t + toCentavos(c.remaining), 0)
      ),
      nextCrNumber: await this.peekNextNumber(BookletType.CR),
      isWithholdingAgent: customer.isWithholdingAgent,
      ewtRatePct: customer.ewtRatePct?.toString() ?? null,
      withholdsVat: customer.withholdsVat,
      vatWithholdingRatePct:
        customer.vatWithholdingRatePct?.toString() ?? null,
    };
  }

  /**
   * Take a payment against a customer's ACCOUNT rather than one job order.
   *
   * The money is applied oldest-invoice-first across every open invoice they
   * have, whatever job order it belongs to, unless the cashier names the
   * invoices themselves. Anything left over is held as customer credit — not
   * refused, and not handed back over the counter.
   *
   * Three quantities move, and they are deliberately not the same number:
   *
   *   received  — tender taken in now. ONLY this counts as the day's
   *               collections; credit is not cash arriving twice.
   *   applied   — what reached the invoices: received + credit spent.
   *   credit    — spent from the account, or newly parked on it.
   */
  async collectFromCustomer(
    actor: Actor,
    input: CollectFromCustomerInput
  ): Promise<CollectResultDto> {
    assertCan(actor, "create", "Sale");

    const customer = await this.customers.findById(input.customerId);
    if (!customer) throw new NotFoundError("Customer not found.");

    const open = await this.openInvoicesFor(input.customerId);
    if (open.length === 0) {
      throw new ValidationError(
        `${customer.name} has nothing outstanding — there is no invoice for this payment to settle.`
      );
    }

    const lines = input.payments ?? [];
    // Reused for its per-line validation; with `due` set to the total there is
    // no shortfall and no change to compute — an account payment is not a
    // counter sale, and money over is parked rather than handed back.
    const received = lines.reduce((t, l) => t + toCentavos(l.amount), 0);
    const settled = settleTenders(lines, received);

    const available = await this.credits.listOpen(input.customerId);
    const creditAvailable = available.reduce(
      (t, c) => t + toCentavos(c.remaining),
      0
    );
    const creditApplied = input.creditApplied
      ? toCentavos(input.creditApplied)
      : 0;
    if (creditApplied < 0) {
      throw new ValidationError("Credit applied cannot be negative.");
    }
    if (creditApplied > creditAvailable) {
      throw new ValidationError(
        `Only ${toAmount(creditAvailable)} of credit is on ${customer.name}'s account.`
      );
    }

    const pool = received + creditApplied;
    if (pool <= 0) {
      throw new ValidationError(
        "Nothing to apply — enter a payment, or apply a credit on file."
      );
    }

    const undocumented = input.issueDocument === false;
    if (received === 0 && !undocumented) {
      // A Collection Receipt acknowledges money handed over. Settling purely
      // from credit moves nothing across the counter, so there is nothing for
      // the receipt to attest to and no reason to burn a serial on it.
      throw new ValidationError(
        "This payment is funded entirely by credit already on file, so no money is being received. Record it without a Collection Receipt."
      );
    }

    const allocations = planAllocations(
      open.map((i) => ({
        id: i.dto.id,
        documentNo: i.dto.documentNo,
        openBalance: i.openBalance,
        suggestedEwt: i.suggestedEwt,
        suggestedVatWht: i.suggestedVatWht,
      })),
      pool,
      input.allocations,
      true
    );
    const applied = allocations.reduce((t, a) => t + toCentavos(a.amount), 0);
    // Tax withheld settles invoices without money arriving, so it is not part
    // of the cash pool and cannot leave anything over. Netting it out here is
    // what stops a withholding payment looking like an overpayment and
    // parking phantom credit on the customer's account.
    const whtTotal = allocations.reduce((t, a) => t + whtOf(a).total, 0);
    const excess = pool - (applied - whtTotal);

    if (creditApplied > 0 && excess > 0) {
      throw new ValidationError(
        `This payment spends ${toAmount(creditApplied)} of credit and would leave ${toAmount(excess)} back on the account. Apply only what the invoices need.`
      );
    }

    const receivedAt = input.receivedAt ? new Date(input.receivedAt) : new Date();
    if (Number.isNaN(receivedAt.getTime())) {
      throw new ValidationError("Invalid payment date.");
    }

    const header = settled.tenders.length
      ? dominantTender(settled.tenders)
      : null;

    const result = await this.receipts.withTransaction(async (tx) => {
      const documentNo = undocumented
        ? null
        : await this.allocateNumber(BookletType.CR, tx);

      const cr = await this.receipts.createCr(
        {
          crNumber: documentNo?.value ?? null,
          documentIssued: !undocumented,
          bookletId: documentNo?.bookletId ?? null,
          customerId: customer.id,
          // Not tied to any one job order — that is the whole point of paying
          // against the account.
          jobOrderId: null,
          amount: toAmount(received),
          method: header?.method ?? PaymentMethod.CASH,
          methodDetail: header?.reference ?? null,
          cashTendered:
            settled.cashTendered === null ? null : toAmount(settled.cashTendered),
          changeGiven: "0.00",
          billedToName: customer.name,
          billedToAddress: customer.address,
          billedToTin: customer.tin,
          receivedAt,
          notes: input.notes?.trim() || null,
          createdById: actor.id,
          payments: settled.tenders.map((t, seq) => ({
            method: t.method,
            amount: toAmount(t.amount),
            reference: t.reference,
            seq,
          })),
          allocations,
        },
        tx
      );

      // Spend credit oldest-first, the same convention as oldest invoice.
      let need = creditApplied;
      for (const credit of available) {
        if (need <= 0) break;
        const take = Math.min(need, toCentavos(credit.remaining));
        await this.credits.apply(credit.id, toAmount(take), cr.id, actor.id, tx);
        need -= take;
      }

      if (excess > 0) {
        await this.credits.create(
          {
            customerId: customer.id,
            amount: toAmount(excess),
            method: header?.method ?? PaymentMethod.CASH,
            reference: header?.reference ?? null,
            receivedAt,
            notes: `Overpayment on ${documentNo?.value ?? "an unreceipted payment"}`,
            createdById: actor.id,
            sourceCollectionReceiptId: cr.id,
          },
          tx
        );
      }

      return { id: cr.id, documentNo: documentNo?.value ?? null };
    });

    const closed = allocations.filter((a) => {
      const invoice = open.find((i) => i.dto.id === a.saleId);
      return invoice && toCentavos(a.amount) >= invoice.openBalance;
    }).length;

    await this.activity.log({
      userId: actor.id,
      entityType: "CollectionReceipt",
      entityId: result.id,
      action: "collect-from-customer",
      payload: {
        customer: customer.name,
        documentNo: result.documentNo ?? "(no document issued)",
        received: toAmount(received),
        applied: toAmount(applied),
        creditUsed: toAmount(creditApplied),
        creditCreated: toAmount(excess),
        invoices: allocations.length,
      },
    });

    return {
      id: result.id,
      documentNo: result.documentNo,
      received: toAmount(received),
      applied: toAmount(applied),
      creditUsed: toAmount(creditApplied),
      creditCreated: toAmount(excess),
      invoicesClosed: closed,
    };
  }

  /** A customer's open invoices across every job order, oldest first. */
  private async openInvoicesFor(customerId: string) {
    const rows = await this.receipts.listReceivables(customerId);
    return rows
      .map((r) => {
        const openBalance = openBalanceOf(
          r.amount,
          r.amountPaid,
          r.settledAmount
        );
        // Suggested only — the cashier enters what the certificates actually
        // say. Both rates apply to the same VAT-EXCLUSIVE base, and the pair
        // is capped TOGETHER at the open balance: a government invoice carries
        // 2% income tax and 5% VAT at once, and separate caps could suggest
        // withholding more in total than the invoice still owes.
        const base = toCentavos(r.vatableSales);
        const suggestedEwt = r.customer.isWithholdingAgent
          ? computeWithholding(base, r.customer.ewtRatePct, openBalance)
          : 0;
        const suggestedVatWht = r.customer.withholdsVat
          ? computeWithholding(
              base,
              r.customer.vatWithholdingRatePct,
              Math.max(openBalance - suggestedEwt, 0)
            )
          : 0;
        return {
          openBalance,
          suggestedEwt,
          suggestedVatWht,
          dto: {
            id: r.id,
            documentNo: r.documentNo,
            kindLabel: RECEIPT_KIND_LABEL[SALE_TYPE_KIND[r.type]],
            saleDate: r.saleDate.toISOString(),
            dueDate: r.dueDate?.toISOString() ?? null,
            amount: r.amount,
            openBalance: toAmount(openBalance),
            daysOverdue: daysOverdueOf(r.dueDate),
            joNumber: r.jobOrderNo,
            vatableSales: r.vatableSales,
            suggestedEwt: toAmount(suggestedEwt),
            suggestedVatWht: toAmount(suggestedVatWht),
          },
        };
      })
      .filter((i) => i.openBalance > 0);
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
    // Every slip is issued for the amount actually paid and books that
    // amount. The tag says the customer is coming back for the balance; it
    // does not move the money out of sales.
    const joDpRows = joRows.filter((s) => s.isDownpayment);

    // A Charge Invoice books revenue at point of sale (docs/sales.txt §3.1.3),
    // so it belongs in gross sales even though the money has not arrived. The
    // Collection Receipt that settles it later is excluded instead — that is
    // what stops the same peso being counted twice.
    //
    // JO slips ARE in it. Each one is issued for what was handed over and
    // books exactly that, so a job paid in two goes appears as two sales that
    // add up to it. Only collections stay out.
    const grossSales =
      sum(vatRows) + sum(nonVatRows) + sum(chargeRows) + sum(joRows);

    // What actually went in the drawer: sales paid at issue, plus deposits,
    // plus collections. A charge invoice contributes only what was handed over
    // at the counter, which is normally nothing.
    const cashIn =
      vatRows.concat(nonVatRows, chargeRows, joRows).reduce(
        (t, r) => t + toCentavos(r.amountPaid.toString()),
        0
      ) + sum(crs);

    // What is still owed on today's receipts, whatever kind they are — net of
    // any collection since, so an invoice paid down today stops counting.
    const owed = sales
      .map((s) =>
        openBalanceOf(
          s.amount.toString(),
          s.amountPaid.toString(),
          s.settledAmount.toString()
        )
      )
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
      joDownpayments: { count: joDpRows.length, gross: toAmount(sum(joDpRows)) },
      collections: { count: crs.length, gross: toAmount(sum(crs)) },
      grossSales: toAmount(grossSales),
      cashIn: toAmount(cashIn),
      receivables: {
        count: owed.length,
        amount: toAmount(owed.reduce((t, d) => t + d, 0)),
      },
      pendingAudit,
    };
  }

  /**
   * Sales over any date range — the daily summary's figures, unpinned.
   *
   * Everything is bucketed in local time, the same way `dayRange` does it, so
   * this report and the daily summary always agree about which day a receipt
   * fell in. Doing it in SQL with `date_trunc` would bucket by the database's
   * timezone and put the first hours of every July back in June.
   */
  async getSalesReport(
    actor: Actor,
    filters: SalesReportFilters
  ): Promise<SalesReportDto> {
    assertCan(actor, "read", "Sale");

    const { from, to, days } = rangeOf(filters.from, filters.to);
    const scope = { from, to, customerId: filters.customerId ?? null };

    const [sales, collections] = await Promise.all([
      this.receipts.listSalesInRange(scope),
      this.receipts.listCollectionsInRange(scope),
    ]);

    // ——— by receipt kind ———
    const byType = {
      JO_RECEIPT: emptySlice(),
      SI_VAT: emptySlice(),
      SI_NON_VAT: emptySlice(),
      SI_CHARGE: emptySlice(),
      // Collections book no revenue, so this stays at zero by construction. It
      // is present only because the DTO is keyed by ReceiptKind; the cash is
      // reported in `totals.collected`, which is the one place it belongs.
      COLLECTION: emptySlice(),
    } satisfies Record<ReceiptKind, SliceAccumulator>;

    // Deposits are accumulated apart from byType.JO_RECEIPT so that row can
    // stay what it says it is: JO slips that were sales. Mixing them made the
    // Summary tab's rows stop adding up to its own total.
    const joDeposits = emptySlice();

    const byPeriod = new Map<string, SliceAccumulator & { collected: number }>();
    const byCustomer = new Map<
      string,
      SliceAccumulator & { customerId: string; customerName: string }
    >();

    const total = emptySlice();

    for (const s of sales) {
      const money = {
        gross: toCentavos(s.amount),
        vatableSales: toCentavos(s.vatableSales),
        vatAmount: toCentavos(s.vatAmount),
      };

      const kind = SALE_TYPE_TO_KIND[s.type];
      add(byType[kind], money);
      // Only a slip TAGGED as a downpayment stays out of the totals. An
      // untagged one is the walk-in's sale document and its money is revenue,
      // exactly as the daily summary now treats it.
      // Descriptive only — the money is in every total either way.
      if (kind === "JO_RECEIPT" && s.isDownpayment) add(joDeposits, money);
      add(total, money);

      const key = periodKeyOf(s.saleDate, filters.groupBy);
      let period = byPeriod.get(key);
      if (!period) {
        period = { ...emptySlice(), collected: 0 };
        byPeriod.set(key, period);
      }
      add(period, money);

      let customer = byCustomer.get(s.customerId);
      if (!customer) {
        customer = {
          ...emptySlice(),
          customerId: s.customerId,
          customerName: s.customerName,
        };
        byCustomer.set(s.customerId, customer);
      }
      add(customer, money);
    }

    // Collections ride along on the period rows so a month's cash can be read
    // beside its sales — but they are never added into either total.
    let collected = 0;
    for (const c of collections) {
      const cents = toCentavos(c.amount);
      collected += cents;
      const key = periodKeyOf(c.receivedAt, filters.groupBy);
      let period = byPeriod.get(key);
      if (!period) {
        period = { ...emptySlice(), collected: 0 };
        byPeriod.set(key, period);
      }
      period.collected += cents;
    }

    const periods = [...byPeriod.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, v]) => ({
        key,
        label: periodLabelOf(key, filters.groupBy),
        count: v.count,
        gross: toAmount(v.gross),
        vatableSales: toAmount(v.vatableSales),
        vatAmount: toAmount(v.vatAmount),
        collected: toAmount(v.collected),
      }));

    const customers = [...byCustomer.values()]
      .sort((a, b) => b.gross - a.gross)
      .map((v) => ({
        customerId: v.customerId,
        customerName: v.customerName,
        count: v.count,
        gross: toAmount(v.gross),
        vatableSales: toAmount(v.vatableSales),
        vatAmount: toAmount(v.vatAmount),
        sharePct:
          total.gross === 0
            ? 0
            : Math.round((v.gross / total.gross) * 1000) / 10,
      }));

    return {
      from: filters.from,
      to: filters.to,
      groupBy: filters.groupBy,
      days,
      byType: {
        JO_RECEIPT: sliceOf(byType.JO_RECEIPT),
        SI_VAT: sliceOf(byType.SI_VAT),
        SI_NON_VAT: sliceOf(byType.SI_NON_VAT),
        SI_CHARGE: sliceOf(byType.SI_CHARGE),
        COLLECTION: sliceOf(byType.COLLECTION),
      },
      byPeriod: periods,
      byCustomer: customers,
      totals: {
        ...sliceOf(total),
        collected: toAmount(collected),
        collectionCount: collections.length,
        deposits: toAmount(joDeposits.gross),
        depositCount: joDeposits.count,
        joSales: toAmount(byType.JO_RECEIPT.gross),
        joSaleCount: byType.JO_RECEIPT.count,
        // Divided by calendar days in the range, not by days that had a sale:
        // a closed Sunday is part of the month's performance.
        averagePerDay: toAmount(Math.round(total.gross / Math.max(days, 1))),
      },
    };
  }

  /**
   * Every document ever raised against one job order, in order, with what was
   * still owed after each. This is the trace: a job may take three
   * downpayments, an invoice and two collections, each on its own serial, and
   * no single one of them says what the customer has actually paid.
   *
   * Cancelled documents stay in the list, marked (R11). A customer disputing
   * their balance is shown exactly this, and a history with the awkward rows
   * quietly removed is not a history.
   */
  async getJobOrderHistory(
    actor: Actor,
    jobOrderId: string
  ): Promise<JobOrderHistoryDto> {
    assertCan(actor, "read", "Sale");

    const jo = await this.receipts.findJobOrder(jobOrderId);
    if (!jo) throw new NotFoundError("Job order not found.");

    const { sales, crs } = await this.receipts.listByJobOrder(jobOrderId);
    const joTotal = joTotalCentavos(jo);

    type Row = {
      id: string;
      date: Date;
      documentNo: string | null;
      kind: ReceiptKind;
      label: string;
      amount: number;
      received: number;
      voided: boolean;
      voidReason: string | null;
    };

    const rows: Row[] = [
      ...sales.map((s): Row => {
        const kind = SALE_TYPE_TO_KIND[s.type];
        const isDp = s.type === SaleType.JO_SLIP && s.isDownpayment;
        return {
          id: s.id,
          date: s.saleDate,
          documentNo: s.documentNo,
          kind,
          label: isDp ? "Downpayment" : RECEIPT_KIND_LABEL[kind],
          amount: toCentavos(s.amount.toString()),
          // What came in ON THIS DOCUMENT. Later collections are their own
          // lines below, so counting settledAmount here would double them.
          received: toCentavos(s.amountPaid.toString()),
          voided: s.voidedAt !== null,
          voidReason: s.voidReason,
        };
      }),
      ...crs.map((c): Row => ({
        id: c.id,
        date: c.receivedAt,
        documentNo: c.crNumber,
        kind: RECEIPT_KIND.COLLECTION,
        label: c.crNumber ? "Collection" : "Collection (no receipt issued)",
        amount: toCentavos(c.amount.toString()),
        received: toCentavos(c.amount.toString()),
        voided: c.voidedAt !== null,
        voidReason: c.voidReason,
      })),
    ].sort((a, b) => a.date.getTime() - b.date.getTime() || a.id.localeCompare(b.id));

    let running = 0;
    const entries = rows.map((r) => {
      // A cancelled document moved no money, so it does not move the balance —
      // but it stays on the list so the serial is still accounted for.
      if (!r.voided) running += r.received;
      return {
        id: r.id,
        date: r.date.toISOString(),
        documentNo: r.documentNo,
        kind: r.kind,
        label: r.label,
        amount: toAmount(r.amount),
        received: toAmount(r.received),
        balanceAfter: toAmount(Math.max(joTotal - running, 0)),
        voided: r.voided,
        voidReason: r.voidReason,
      };
    });

    const depositsHeld = sales
      .filter((s) => s.voidedAt === null && s.type === SaleType.JO_SLIP && s.isDownpayment)
      .reduce((total, s) => total + toCentavos(s.amountPaid.toString()), 0);

    return {
      jobOrderId: jo.id,
      joNumber: jo.joNumber,
      customerName: jo.customer.name,
      joTotal: toAmount(joTotal),
      entries,
      totalReceived: toAmount(running),
      stillDue: toAmount(Math.max(joTotal - running, 0)),
      depositsHeld: toAmount(depositsHeld),
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

// ——— position: what a job order has been billed, and what it has paid ———

/**
 * Still owed on one invoice, never below zero. All three args are Decimals.
 *
 * Positional wrapper over the canonical `openBalanceOf` in money.ts — the
 * maths has exactly one definition; this is only the shape the call sites in
 * this file already use.
 */
function openBalanceOf(
  amount: string,
  amountPaid: string,
  settledAmount: string
): number {
  return sharedOpenBalanceOf({ amount, amountPaid, settledAmount });
}

/**
 * Work out a job order's whole money position from its receipts.
 *
 * Cancelled receipts contribute NOTHING — that is the point of voiding one:
 * the job reopens and the counter can issue a fresh receipt (docs/sales.txt
 * §5). So every sum here runs over live rows only.
 */
/**
 * The downpayment the quotation agreed, priced against this job's total.
 *
 * Null when the job was encoded directly, or quoted at full payment — there is
 * nothing to suggest, and suggesting zero would be worse than suggesting
 * nothing. Rounded to the centavo the same way every other figure is.
 */
function agreedDownpaymentOf(
  jo: JoForReceiptRecord,
  joTotalCents: number
): { rate: string; label: string | null; amount: string } | null {
  const rate = jo.quotation?.downpaymentRate;
  if (rate === null || rate === undefined) return null;
  const fraction = Number(rate.toString());
  if (!Number.isFinite(fraction) || fraction <= 0 || fraction >= 1) return null;
  return {
    rate: rate.toString(),
    label: jo.quotation?.paymentTermLabel ?? null,
    amount: toAmount(Math.round(joTotalCents * fraction)),
  };
}

function positionOf(
  jo: JoForReceiptRecord,
  sales: SaleRecord[],
  crs: CrRecord[]
): JoPosition {
  const liveSales = sales.filter((s) => s.voidedAt === null);
  const liveCrs = crs.filter((c) => c.voidedAt === null);

  const joTotal = joTotalCentavos(jo);
  const billed = liveSales.reduce(
    (t, s) => t + toCentavos(s.amount.toString()),
    0
  );

  // Money in AGAINST THIS JOB. Shared with the Job Order board, which shows
  // the same figure as a Paid / Partial / Unpaid badge — see money.ts for why
  // it is read off the invoices rather than off this job's own collections.
  const collected = joCollectedCentavos({ sales: liveSales, crs: liveCrs });

  const openInvoices = liveSales
    .map((sale) => ({
      sale,
      openBalance: openBalanceOf(
        sale.amount.toString(),
        sale.amountPaid.toString(),
        sale.settledAmount.toString()
      ),
    }))
    .filter((x) => x.openBalance > 0)
    // Oldest first — the order collections are applied in.
    .sort((a, b) => a.sale.saleDate.getTime() - b.sale.saleDate.getTime());

  return {
    joTotal,
    billed,
    collected,
    unbilled: Math.max(joTotal - billed, 0),
    outstanding: openInvoices.reduce((t, x) => t + x.openBalance, 0),
    hasInvoice: liveSales.some((s) => s.type !== SaleType.JO_SLIP),
    hasJoReceipt: liveSales.some((s) => s.type === SaleType.JO_SLIP),
    openInvoices,
  };
}

type CreditPosition = {
  enabled: boolean;
  termDays: number | null;
  limit: string | null;
  customerOutstanding: string;
  available: string | null;
};

/**
 * The STRUCTURAL reason a receipt kind cannot be issued — everything that does
 * not depend on the amount. Shared by the server gate and the dialog's tiles,
 * deliberately: a greyed-out tile and a rejected request must never disagree
 * about why.
 */
function blockReasonFor(
  kind: ReceiptKind,
  position: JoPosition,
  credit: CreditPosition
): string | null {
  if (kind === RECEIPT_KIND.COLLECTION) {
    return position.outstanding > 0
      ? null
      : "Nothing is outstanding on this job order — a collection settles an invoice already issued.";
  }

  // A Job Order Receipt means the customer never asked for an invoice. Once
  // either has been issued the other is off the table, or the same sale would
  // be counted twice in the day's gross.
  if (kind === RECEIPT_KIND.JO_RECEIPT && position.hasInvoice) {
    return "This job order has already been invoiced. A Job Order Receipt is only for a sale with no invoice.";
  }
  if (INVOICE_KINDS.includes(kind) && position.hasJoReceipt) {
    return "This job order was acknowledged with a Job Order Receipt, which stands in place of an invoice.";
  }

  if (position.unbilled <= 0) {
    return "This job order is already invoiced in full. Cancel or replace a receipt to reopen it.";
  }

  if (
    kind === RECEIPT_KIND.SI_CHARGE &&
    credit.enabled &&
    credit.limit !== null &&
    toCentavos(credit.available ?? "0") <= 0
  ) {
    return `This customer is at their ${credit.limit} credit limit — ${credit.customerOutstanding} is already outstanding.`;
  }

  return null;
}

/** Per-kind availability for the dialog: structural rules plus booklet stock. */
function availabilityOf(
  position: JoPosition,
  credit: CreditPosition,
  nextNumbers: Record<ReceiptKind, string | null>
): Record<ReceiptKind, ReceiptAvailabilityDto> {
  const out = {} as Record<ReceiptKind, ReceiptAvailabilityDto>;
  for (const kind of Object.values(RECEIPT_KIND)) {
    let reason = blockReasonFor(kind, position, credit);
    // A collection with no CR booklet is still allowed — the receipt is
    // optional, so an empty booklet only costs the printed document.
    if (!reason && !nextNumbers[kind] && kind !== RECEIPT_KIND.COLLECTION) {
      reason = `No active booklet for ${RECEIPT_KIND_LABEL[kind]}. Register and approve one under Sales Audit Maintenance.`;
    }
    out[kind] = { enabled: reason === null, reason };
  }
  return out;
}

/** The kind the counter should reach for, preselected in the dialog. */
function recommendKind(
  position: JoPosition,
  availability: Record<ReceiptKind, ReceiptAvailabilityDto>,
  vatRegistered: boolean
): ReceiptKind | null {
  const ok = (k: ReceiptKind) => availability[k].enabled;

  // Still something to bill: the VAT status on the customer record decides
  // which invoice, which is the question the cashier used to have to ask.
  if (position.unbilled > 0) {
    const preferred = vatRegistered
      ? RECEIPT_KIND.SI_VAT
      : RECEIPT_KIND.SI_NON_VAT;
    if (ok(preferred)) return preferred;
  }
  // Fully billed but not fully collected — the customer is here to pay.
  if (position.outstanding > 0 && ok(RECEIPT_KIND.COLLECTION)) {
    return RECEIPT_KIND.COLLECTION;
  }
  return Object.values(RECEIPT_KIND).find(ok) ?? null;
}

/** The server gate: structural rules, then the amount caps. */
function assertIssuable(args: {
  kind: ReceiptKind;
  amount: number;
  position: JoPosition;
  credit: CreditPosition;
}): void {
  const { kind, amount, position, credit } = args;

  const reason = blockReasonFor(kind, position, credit);
  if (reason) throw new ValidationError(reason);

  if (kind === RECEIPT_KIND.COLLECTION) {
    if (amount > position.outstanding) {
      throw new ValidationError(
        `Collecting ${toAmount(amount)} but only ${toAmount(position.outstanding)} is outstanding on this job order.`
      );
    }
    return;
  }

  if (amount > position.unbilled) {
    throw new ValidationError(
      `Billing ${toAmount(amount)} but only ${toAmount(position.unbilled)} is left to invoice on this job order.`
    );
  }

  if (kind === RECEIPT_KIND.SI_CHARGE && credit.enabled && credit.limit !== null) {
    const available =
      toCentavos(credit.limit) - toCentavos(credit.customerOutstanding);
    if (amount > available) {
      throw new ValidationError(
        `${toAmount(amount)} on credit would put this customer past their ${credit.limit} limit — ` +
          `${credit.customerOutstanding} is already outstanding, leaving ${toAmount(Math.max(available, 0))} available.`
      );
    }
  }
}

/**
 * Which invoices a collection pays down. "No floating CRs" (spec 2.4): every
 * peso must land on a specific invoice, so this either validates what the
 * cashier chose or applies it oldest-first, which is what they do by hand.
 */
function planAllocations(
  invoices: AllocatableInvoice[],
  /**
   * CASH available to apply: tender received plus any credit spent. Tax
   * withheld is deliberately NOT in here — it settles invoices without money
   * arriving, so it is accounted for per allocation instead.
   */
  pool: number,
  requested?: {
    saleId: string;
    amount: string;
    ewtWithheld?: string;
    vatWithheld?: string;
  }[],
  /**
   * May the money exceed what the invoices need?
   *
   * At the counter, no: a job-scoped collection is capped at that job's
   * outstanding, so every peso must land somewhere. On a customer account,
   * yes: the excess becomes credit held for them, the way QuickBooks parks an
   * overpayment.
   */
  allowExcess = false
): AllocationCreateData[] {
  if (pool <= 0) return [];

  if (requested && requested.length > 0) {
    const seen = new Set<string>();
    for (const a of requested) {
      if (seen.has(a.saleId)) {
        throw new ValidationError(
          "The same invoice is listed twice — combine it into one line."
        );
      }
      seen.add(a.saleId);

      const invoice = invoices.find((x) => x.id === a.saleId);
      if (!invoice) {
        throw new ValidationError(
          "A payment can only be applied to an invoice that is still open."
        );
      }
      if (toCentavos(a.amount) > invoice.openBalance) {
        throw new ValidationError(
          `${toAmount(toCentavos(a.amount))} applied to ${invoice.documentNo}, which only has ${toAmount(invoice.openBalance)} outstanding.`
        );
      }
      const withheld = whtOf(a);
      if (withheld.ewt < 0 || withheld.vat < 0) {
        throw new ValidationError("Tax withheld cannot be negative.");
      }
      if (withheld.total > toCentavos(a.amount)) {
        throw new ValidationError(
          `${toAmount(withheld.total)} withheld on ${invoice.documentNo} is more than the ${toAmount(toCentavos(a.amount))} being settled against it.`
        );
      }
    }

    const total = requested.reduce((t, a) => t + toCentavos(a.amount), 0);
    const whtTotal = requested.reduce((t, a) => t + whtOf(a).total, 0);
    // Withheld tax settles the invoice without any money arriving, so the
    // cash the allocations actually call for is what is left after it. This
    // is the balancing identity from docs/sales-contract.md R5, rearranged:
    //   received + creditApplied + ewtWithheld + vatWithheld
    //     = Σ allocations + creditCreated
    const cashRequired = total - whtTotal;
    if (cashRequired > pool) {
      throw new ValidationError(
        `The allocations need ${toAmount(cashRequired)} in payment${whtTotal > 0 ? ` (after ${toAmount(whtTotal)} withheld)` : ""} but only ${toAmount(pool)} is available to apply.`
      );
    }
    if (!allowExcess && cashRequired !== pool) {
      throw new ValidationError(
        `The allocations account for ${toAmount(cashRequired)} but ${toAmount(pool)} was collected — every peso must be applied to an invoice.`
      );
    }
    return requested.map((a) => ({
      saleId: a.saleId,
      amount: a.amount,
      ewtWithheld: a.ewtWithheld ?? "0",
      vatWithheld: a.vatWithheld ?? "0",
    }));
  }

  // Auto-allocation, oldest invoice first — what the counter does by hand.
  //
  // `pool` here is CASH ONLY (received + credit). Withholding is not in it,
  // because how much is withheld depends on which invoices this payment
  // reaches, which is what we are working out. So each invoice is measured by
  // the cash it needs — its open balance LESS the tax the customer keeps back
  // — and the allocation still records the full balance, which is what closes
  // it.
  let remaining = pool;
  const out: AllocationCreateData[] = [];
  for (const invoice of invoices) {
    if (remaining <= 0) break;
    const ewt = invoice.suggestedEwt ?? 0;
    const vat = invoice.suggestedVatWht ?? 0;
    const cashToClose = invoice.openBalance - ewt - vat;

    if (remaining >= cashToClose) {
      // Enough cash to settle it net of withholding: the invoice closes in
      // full and the withheld parts are recorded rather than left owing.
      out.push({
        saleId: invoice.id,
        amount: toAmount(invoice.openBalance),
        ewtWithheld: toAmount(ewt),
        vatWithheld: toAmount(vat),
      });
      remaining -= cashToClose;
    } else {
      // Not enough to settle this one. A part payment carries NO withholding:
      // the customer withholds when they settle the invoice, not on account,
      // and claiming tax against a debt that is still open would close it by
      // more than was actually paid.
      out.push({
        saleId: invoice.id,
        amount: toAmount(remaining),
        ewtWithheld: "0",
        vatWithheld: "0",
      });
      remaining = 0;
    }
  }
  if (remaining > 0 && !allowExcess) {
    // Unreachable on the counter path: assertIssuable already capped the
    // amount at `outstanding`.
    throw new ValidationError(
      `${toAmount(remaining)} of this collection has no open invoice to apply to.`
    );
  }
  return out;
}

/** The shape planAllocations works in, whichever ledger it came from. */
type AllocatableInvoice = {
  id: string;
  documentNo: string;
  openBalance: number;
  /**
   * Creditable INCOME tax this customer is expected to withhold on this
   * invoice, in centavos. Absent or 0 for everyone who is not a withholding
   * agent — the ordinary case, which leaves the allocation maths as it was.
   */
  suggestedEwt?: number;
  /** Creditable VAT expected to be withheld (government / LGU), in centavos. */
  suggestedVatWht?: number;
};

/** Both withholdings on one requested allocation, in centavos. */
function whtOf(a: { ewtWithheld?: string; vatWithheld?: string }) {
  const ewt = a.ewtWithheld ? toCentavos(a.ewtWithheld) : 0;
  const vat = a.vatWithheld ? toCentavos(a.vatWithheld) : 0;
  return { ewt, vat, total: ewt + vat };
}

/** Days past due, floored at 0. Null when the invoice carries no terms. */
function daysOverdueOf(dueDate: Date | null): number | null {
  if (!dueDate) return null;
  return Math.max(
    0,
    Math.floor((Date.now() - dueDate.getTime()) / 86_400_000)
  );
}

function toCreditDto(c: {
  id: string;
  amount: string;
  applied: string;
  remaining: string;
  method: PaymentMethod;
  reference: string | null;
  receivedAt: Date;
  status: "UNAPPLIED" | "PARTIALLY_APPLIED" | "FULLY_APPLIED";
  sourceDocumentNo: string | null;
}): CustomerCreditDto {
  return { ...c, receivedAt: c.receivedAt.toISOString() };
}

function toOpenInvoice(
  sale: SaleRecord,
  openBalance: number,
  /** The billed customer's withholding standing, when it is known. */
  withholding?: {
    isWithholdingAgent: boolean;
    ewtRatePct: unknown;
    withholdsVat: boolean;
    vatWithholdingRatePct: unknown;
  }
): OpenInvoiceDto {
  const vatableSales = sale.vatableSales.toString();
  const rate = (v: unknown) =>
    v === null || v === undefined ? null : String(v);
  const base = toCentavos(vatableSales);
  const ewt = withholding?.isWithholdingAgent
    ? computeWithholding(base, rate(withholding.ewtRatePct), openBalance)
    : 0;
  // Capped against what the income tax has already taken, so the two together
  // can never suggest withholding more than the invoice still owes.
  const vat = withholding?.withholdsVat
    ? computeWithholding(
        base,
        rate(withholding.vatWithholdingRatePct),
        Math.max(openBalance - ewt, 0)
      )
    : 0;
  return {
    id: sale.id,
    documentNo: sale.documentNo,
    kindLabel: RECEIPT_KIND_LABEL[SALE_TYPE_KIND[sale.type]],
    saleDate: sale.saleDate.toISOString(),
    dueDate: sale.dueDate?.toISOString() ?? null,
    amount: sale.amount.toString(),
    openBalance: toAmount(openBalance),
    daysOverdue: daysOverdueOf(sale.dueDate),
    vatableSales,
    suggestedEwt: toAmount(ewt),
    suggestedVatWht: toAmount(vat),
  };
}

// ——— helpers ———

function kindOfBooklet(type: BookletType): ReceiptKind {
  const found = (Object.keys(KIND_BOOKLET) as ReceiptKind[]).find(
    (k) => KIND_BOOKLET[k] === type
  );
  return found ?? RECEIPT_KIND.SI_VAT;
}

/** JO total, falling back to the sum of its line items when total is unset. */
/** Local-day window [00:00, next 00:00) for a YYYY-MM-DD key. */
// ——— sales report helpers ————————————————————————————————————————————

/** How many calendar days a report may cover in one go. */
const MAX_REPORT_DAYS = 366;

type SliceAccumulator = {
  count: number;
  gross: number;
  vatableSales: number;
  vatAmount: number;
};

const emptySlice = (): SliceAccumulator => ({
  count: 0,
  gross: 0,
  vatableSales: 0,
  vatAmount: 0,
});

function add(
  into: SliceAccumulator,
  money: { gross: number; vatableSales: number; vatAmount: number }
): void {
  into.count += 1;
  into.gross += money.gross;
  into.vatableSales += money.vatableSales;
  into.vatAmount += money.vatAmount;
}

const sliceOf = (s: SliceAccumulator) => ({
  count: s.count,
  gross: toAmount(s.gross),
  vatableSales: toAmount(s.vatableSales),
  vatAmount: toAmount(s.vatAmount),
});

/** `Sale.type` → the receipt kind the DTOs are keyed by. */
const SALE_TYPE_TO_KIND: Record<SaleType, ReceiptKind> = {
  SI_VAT: "SI_VAT",
  SI_NON_VAT: "SI_NON_VAT",
  SI_CHARGE: "SI_CHARGE",
  JO_SLIP: "JO_RECEIPT",
};

/**
 * `from` at local midnight to the local midnight AFTER `to`, so the last day
 * of the range is included whatever time of day its receipts were written.
 */
function rangeOf(
  fromDate: string,
  toDate: string
): { from: Date; to: Date; days: number } {
  const start = new Date(`${fromDate}T00:00:00`);
  const end = new Date(`${toDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new ValidationError("Invalid date.");
  }
  if (end < start) {
    throw new ValidationError("The range ends before it starts.");
  }
  const from = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const to = new Date(
    end.getFullYear(),
    end.getMonth(),
    end.getDate() + 1
  );
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000);
  if (days > MAX_REPORT_DAYS) {
    throw new ValidationError(
      `That range covers ${days} days. Report a year or less at a time.`
    );
  }
  return { from, to, days };
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The bucket a receipt falls in, from its LOCAL date — the same reading of
 * "which day is this" as the daily summary uses. Keys sort lexicographically,
 * which is what orders the report.
 */
function periodKeyOf(d: Date, groupBy: SalesGranularity): string {
  const y = d.getFullYear();
  if (groupBy === "month") return `${y}-${pad(d.getMonth() + 1)}`;
  if (groupBy === "day") {
    return `${y}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  // ISO week: Monday-based, and the year is the WEEK's year rather than the
  // date's — 1 January can belong to week 52 of the year before, and keying it
  // under the wrong year puts it at the wrong end of the report.
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayOfWeek = (t.getDay() + 6) % 7;
  t.setDate(t.getDate() - dayOfWeek + 3);
  const firstThursday = new Date(t.getFullYear(), 0, 4);
  const firstDow = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstDow + 3);
  const week =
    1 + Math.round((t.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${t.getFullYear()}-W${pad(week)}`;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function periodLabelOf(key: string, groupBy: SalesGranularity): string {
  if (groupBy === "month") {
    const [y, m] = key.split("-");
    return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
  }
  if (groupBy === "week") return key.replace("-W", " · week ");
  const [y, m, d] = key.split("-");
  return `${d} ${MONTH_NAMES[Number(m) - 1]?.slice(0, 3)} ${y}`;
}

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
    documentIssued: true,
    customerName: s.billedToName ?? s.customer.name,
    joNumber: s.jobOrder?.joNumber ?? null,
    amount: s.amount.toString(),
    vatableSales: s.vatableSales.toString(),
    vatAmount: s.vatAmount.toString(),
    amountPaid: s.amountPaid.toString(),
    settledAmount: s.settledAmount.toString(),
    // Net of collections since issue — an invoice paid down by a CR is no
    // longer owed, even though amountPaid still reads what the paper says.
    //
    // A CANCELLED receipt owes NOTHING. Only the document was cancelled, not
    // the underlying job, so the job's balance reopens and is re-billed on a
    // fresh receipt — leaving a debt on the cancelled one too would show the
    // same money owed twice. Zeroed here rather than in one view so no future
    // caller can reintroduce the double-count.
    balanceDue: s.voidedAt
      ? "0.00"
      : toAmount(
          openBalanceOf(
            s.amount.toString(),
            s.amountPaid.toString(),
            s.settledAmount.toString()
          )
        ),
    dueDate: s.dueDate?.toISOString() ?? null,
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
    // Null when the customer declined the printed receipt — the payment is
    // still on the ledger, it simply has no serial to show.
    documentNo: c.crNumber,
    documentIssued: c.documentIssued,
    customerName: c.billedToName ?? c.customer.name,
    joNumber: c.jobOrder?.joNumber ?? null,
    amount: c.amount.toString(),
    // A collection is not revenue — it carries no VAT split.
    vatableSales: "0.00",
    vatAmount: "0.00",
    amountPaid: c.amount.toString(),
    settledAmount: "0.00",
    // A collection acknowledges what came in — it is never itself unpaid.
    balanceDue: "0.00",
    dueDate: null,
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
    new PrismaActivityLogRepository(),
    new PrismaModuleFlagRepository(),
    new PrismaCreditRepository(),
    new PrismaCustomerRepository()
  );
  return instance;
}
