import { assertCan } from "@/lib/ability";
import type { Actor } from "@/lib/authz";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { resolveEnabledModules } from "@/lib/modules";
import type { IActivityLogRepository } from "@/modules/shared/repositories/activity-log-repository";
import { PrismaActivityLogRepository } from "@/modules/shared/repositories/activity-log-repository";
import type { ICustomerRepository } from "@/modules/shared/repositories/customer-repository";
import { PrismaCustomerRepository } from "@/modules/shared/repositories/customer-repository";
import type { IModuleFlagRepository } from "@/modules/shared/repositories/module-flag-repository";
import { PrismaModuleFlagRepository } from "@/modules/shared/repositories/module-flag-repository";
import type { ICreditRepository } from "../repositories/credit-repository";
import { PrismaCreditRepository } from "../repositories/credit-repository";
import type {
  IReceiptRepository,
  ReceivableRecord,
} from "../repositories/receipt-repository";
import { PrismaReceiptRepository } from "../repositories/receipt-repository";
import {
  AGING_BUCKETS,
  RECEIPT_KIND_LABEL,
  bucketFor,
  type AgingBucket,
  type ReceivableCustomerDto,
  type ReceivableFilters,
  type CustomerAccountDto,
  type CustomerCreditDto,
  type ReceivablesPageDto,
  type SetCreditInput,
  type SetWithholdingInput,
  type StatementOfAccountDto,
} from "../schemas/receipt";
import { VAT_WITHHOLDING_RATE_PCT, toAmount, toCentavos } from "./money";

// ══════════════════════════════════════════════════════════════════════════
// ACCOUNTS RECEIVABLE — who owes us what, and for how long.
//
// Nothing here writes: a receivable is not a record of its own, it is what
// falls out of an invoice that has not been collected in full. The writing
// happens in ReceiptService, when a collection allocates against invoices.
// ══════════════════════════════════════════════════════════════════════════

const SALE_TYPE_KIND = {
  SI_VAT: "SI_VAT",
  SI_NON_VAT: "SI_NON_VAT",
  SI_CHARGE: "SI_CHARGE",
  JO_SLIP: "JO_RECEIPT",
} as const;

const emptyAging = (): Record<AgingBucket, number> => ({
  CURRENT: 0,
  D1_30: 0,
  D31_60: 0,
  D61_90: 0,
  D90_PLUS: 0,
});

const formatAging = (
  buckets: Record<AgingBucket, number>
): Record<AgingBucket, string> =>
  Object.fromEntries(
    AGING_BUCKETS.map((b) => [b, toAmount(buckets[b])])
  ) as Record<AgingBucket, string>;

/** Still owed on one invoice, never below zero. */
function openBalanceOf(r: ReceivableRecord): number {
  return Math.max(
    toCentavos(r.amount) -
      toCentavos(r.amountPaid) -
      toCentavos(r.settledAmount),
    0
  );
}

/**
 * Days past due, floored at 0. Null when the invoice carries no terms.
 *
 * Measured from the REPORT date, not from now: an invoice 90 days overdue
 * today may have been perfectly current at the date being reported on, and an
 * aging report that ages everything to today puts every historical debt in the
 * wrong bucket while still footing to the right total.
 */
function daysOverdueOf(dueDate: Date | null, asOf: Date): number | null {
  if (!dueDate) return null;
  return Math.max(
    0,
    Math.floor((asOf.getTime() - dueDate.getTime()) / 86_400_000)
  );
}

/**
 * "2026-06-30" → the last instant of that day, so an invoice raised on the
 * 30th counts in a report as at the 30th. Undefined → now.
 */
function reportDate(asOf: string | undefined): Date {
  if (!asOf) return new Date();
  const d = new Date(`${asOf}T00:00:00`);
  if (Number.isNaN(d.getTime())) {
    throw new ValidationError("That is not a valid date.");
  }
  d.setHours(23, 59, 59, 999);
  return d;
}

/** True when the caller asked for a past date rather than today. */
const isHistorical = (asOf: string | undefined): boolean => Boolean(asOf);

export class ReceivableService {
  constructor(
    private readonly receipts: IReceiptRepository,
    private readonly flags: IModuleFlagRepository,
    private readonly customers: ICustomerRepository,
    private readonly activity: IActivityLogRepository,
    private readonly credits: ICreditRepository
  ) {}

  private async creditControlEnabled(): Promise<boolean> {
    const rows = await this.flags.listOverrides();
    return resolveEnabledModules(
      new Map(rows.map((r) => [r.key, r.enabled]))
    ).has("credit-control");
  }

  /** The A/R ledger, one line per customer, aged. */
  async list(
    actor: Actor,
    filters: ReceivableFilters = {}
  ): Promise<ReceivablesPageDto> {
    assertCan(actor, "read", "Sale");

    const creditControlEnabled = await this.creditControlEnabled();
    const asOf = reportDate(filters.asOf);
    const historical = isHistorical(filters.asOf);

    // The repository filter is a superset — invoices settled by a later
    // collection come back too, and are dropped here by their open balance.
    const open = (
      await this.receipts.listReceivables(
        undefined,
        historical ? asOf : undefined
      )
    ).filter((r) => openBalanceOf(r) > 0);

    // Credit held FOR customers, keyed the same way. A customer can hold
    // credit while owing nothing, so this also contributes rows of its own.
    //
    // On a historical report this is deliberately skipped rather than shown
    // as-at-today beside as-at-June debt. A credit balance has no dated trail
    // to rewind through, and mixing the two would put a credit the customer
    // only earned in August against what they owed in June.
    const creditRows = historical ? [] : await this.credits.listOpenAll();
    const creditByCustomer = new Map<string, number>();
    const nameByCustomer = new Map<string, string>();
    for (const c of creditRows) {
      creditByCustomer.set(
        c.customerId,
        (creditByCustomer.get(c.customerId) ?? 0) + toCentavos(c.remaining)
      );
      nameByCustomer.set(c.customerId, c.customerName);
    }

    const byCustomer = new Map<string, ReceivableRecord[]>();
    for (const r of open) {
      const bucket = byCustomer.get(r.customer.id);
      if (bucket) bucket.push(r);
      else byCustomer.set(r.customer.id, [r]);
    }
    // Credit-only customers: no open invoice, but money of theirs on hand.
    for (const customerId of creditByCustomer.keys()) {
      if (!byCustomer.has(customerId)) byCustomer.set(customerId, []);
    }

    // Company-wide exposure, before any per-customer line is built.
    //
    // A company's ceiling is agreed with the COMPANY and denormalised onto each
    // of its contacts, so checking each contact against it independently grants
    // the whole ceiling once per contact — five contacts on a ₱100k limit carry
    // ₱500k and every one of them reads as comfortably inside their limit
    // (docs/sales-contract.md R15). Exposure is therefore summed per company
    // first, and each contact's line is judged against that total.
    const exposureByCompany = new Map<string, number>();
    for (const r of open) {
      const companyId = r.customer.companyId;
      if (!companyId) continue;
      exposureByCompany.set(
        companyId,
        (exposureByCompany.get(companyId) ?? 0) + openBalanceOf(r)
      );
    }

    let customers: ReceivableCustomerDto[] = [];
    for (const [customerId, rows] of byCustomer) {
      const first = rows[0] as ReceivableRecord | undefined;
      if (!first) {
        // Holds credit, owes nothing — everything below is zero except the
        // credit itself, so it is built directly rather than aged.
        customers.push({
          customerId,
          customerName: nameByCustomer.get(customerId) ?? "",
          invoiceCount: 0,
          outstanding: "0.00",
          oldestDaysOverdue: null,
          aging: formatAging(emptyAging()),
          creditTermDays: null,
          creditLimit: null,
          creditAvailable: null,
          overLimit: false,
          creditOnAccount: toAmount(creditByCustomer.get(customerId) ?? 0),
          companyId: null,
          companyName: null,
          exposure: "0.00",
        });
        continue;
      }
      const aging = emptyAging();
      let outstanding = 0;
      let oldest: number | null = null;

      for (const r of rows) {
        const owed = openBalanceOf(r);
        const days = daysOverdueOf(r.dueDate, asOf);
        outstanding += owed;
        aging[bucketFor(days)] += owed;
        if (days !== null && (oldest === null || days > oldest)) oldest = days;
      }

      const limit =
        first.customer.creditLimit === null
          ? null
          : toCentavos(first.customer.creditLimit);

      // The ceiling is judged against whatever it was agreed with: the company's
      // whole exposure for a contact, this person's alone for an individual.
      const companyId = first.customer.companyId;
      const chargedExposure =
        companyId !== null
          ? exposureByCompany.get(companyId) ?? outstanding
          : outstanding;
      const available = limit === null ? null : limit - chargedExposure;

      customers.push({
        customerId: first.customer.id,
        customerName: first.customer.name,
        invoiceCount: rows.length,
        outstanding: toAmount(outstanding),
        oldestDaysOverdue: oldest,
        aging: formatAging(aging),
        creditTermDays: first.customer.creditTermDays,
        creditLimit: limit === null ? null : toAmount(limit),
        creditAvailable: available === null ? null : toAmount(available),
        overLimit: available !== null && available < 0,
        creditOnAccount: toAmount(creditByCustomer.get(customerId) ?? 0),
        companyId,
        companyName: first.customer.companyName,
        // What the ceiling is actually measured against. Equal to `outstanding`
        // for an individual; the company's total for a contact — which is the
        // number that explains an "over limit" flag on a contact who personally
        // owes very little.
        exposure: toAmount(chargedExposure),
      });
    }

    // Biggest debt first — that is the order a collections list gets worked.
    customers.sort(
      (a, b) => toCentavos(b.outstanding) - toCentavos(a.outstanding)
    );

    if (filters.q) {
      const needle = filters.q.toLowerCase();
      customers = customers.filter((c) =>
        c.customerName.toLowerCase().includes(needle)
      );
    }
    if (filters.bucket) {
      const bucket = filters.bucket;
      customers = customers.filter((c) => toCentavos(c.aging[bucket]) > 0);
    }
    if (filters.overLimitOnly) {
      customers = customers.filter((c) => c.overLimit);
    }

    const totals = emptyAging();
    for (const c of customers) {
      for (const b of AGING_BUCKETS) totals[b] += toCentavos(c.aging[b]);
    }

    return {
      summary: {
        asOf: asOf.toISOString(),
        historical,
        totalOutstanding: toAmount(
          customers.reduce((t, c) => t + toCentavos(c.outstanding), 0)
        ),
        customerCount: customers.length,
        invoiceCount: customers.reduce((t, c) => t + c.invoiceCount, 0),
        aging: formatAging(totals),
        overLimitCount: customers.filter((c) => c.overLimit).length,
        totalCreditOnAccount: toAmount(
          customers.reduce((t, c) => t + toCentavos(c.creditOnAccount), 0)
        ),
      },
      customers,
      creditControlEnabled,
    };
  }

  /** One customer's Statement of Account — every open invoice, oldest first. */
  async statement(
    actor: Actor,
    customerId: string,
    asOfDate?: string
  ): Promise<StatementOfAccountDto> {
    assertCan(actor, "read", "Sale");

    // Identity comes from the customer record, NOT from an open invoice: a
    // customer who has just paid everything off still has a statement, and
    // reading their name off a row that no longer exists produced a blank one.
    const customer = await this.customers.findById(customerId);
    if (!customer) throw new NotFoundError("Customer not found.");

    const asOf = reportDate(asOfDate);
    const rows = (
      await this.receipts.listReceivables(
        customerId,
        isHistorical(asOfDate) ? asOf : undefined
      )
    ).filter((r) => openBalanceOf(r) > 0);

    const aging = emptyAging();
    const invoices = rows.map((r) => {
      const owed = openBalanceOf(r);
      const days = daysOverdueOf(r.dueDate, asOf);
      const bucket = bucketFor(days);
      aging[bucket] += owed;
      return {
        id: r.id,
        documentNo: r.documentNo,
        kindLabel: RECEIPT_KIND_LABEL[SALE_TYPE_KIND[r.type]],
        saleDate: r.saleDate.toISOString(),
        dueDate: r.dueDate?.toISOString() ?? null,
        amount: r.amount,
        openBalance: toAmount(owed),
        daysOverdue: days,
        joNumber: r.jobOrderNo,
        bucket,
        vatableSales: r.vatableSales,
        // A statement reports what is owed; it takes no payment, so there is
        // nothing here to withhold against. The counter suggests the figure at
        // collection time, where the 2307 is actually handed over.
        suggestedEwt: "0.00",
        suggestedVatWht: "0.00",
      };
    });

    return {
      customerId: customer.id,
      customerName: customer.name,
      customerAddress: customer.address,
      customerTin: customer.tin,
      asOf: asOf.toISOString(),
      invoices,
      totalOutstanding: toAmount(
        rows.reduce((t, r) => t + openBalanceOf(r), 0)
      ),
      aging: formatAging(aging),
      creditTermDays: customer.creditTermDays,
      creditLimit: customer.creditLimit,
    };
  }

  /** One customer's whole account — debts, credits, and payment history. */
  async account(actor: Actor, customerId: string): Promise<CustomerAccountDto> {
    assertCan(actor, "read", "Sale");

    const customer = await this.customers.findById(customerId);
    if (!customer) throw new NotFoundError("Customer not found.");

    const [rows, credits, payments, creditControlEnabled] = await Promise.all([
      this.receipts.listReceivables(customerId),
      this.credits.listAll(customerId),
      this.receipts.listPaymentsForCustomer(customerId),
      this.creditControlEnabled(),
    ]);

    // Exposure and the over-limit verdict are computed HERE, not by whoever
    // renders this, so the customer profile and the A/R ledger cannot disagree
    // about whether someone is over their limit. For a company contact that
    // means loading the company's other contacts too — their invoices count
    // against the same ceiling (docs/sales-contract.md R15).
    const companyId = rows[0]?.customer.companyId ?? null;
    const companyName = rows[0]?.customer.companyName ?? null;
    const companyRows = companyId
      ? (await this.receipts.listReceivables()).filter(
          (r) => r.customer.companyId === companyId
        )
      : [];

    const open = rows.filter((r) => openBalanceOf(r) > 0);
    const aging = emptyAging();
    // The account screen is always live — it is what a cashier reads with the
    // customer standing there, so it ages to today and nothing else.
    const now = new Date();
    const invoices = open.map((r) => {
      const owed = openBalanceOf(r);
      const days = daysOverdueOf(r.dueDate, now);
      const bucket = bucketFor(days);
      aging[bucket] += owed;
      return {
        id: r.id,
        documentNo: r.documentNo,
        kindLabel: RECEIPT_KIND_LABEL[SALE_TYPE_KIND[r.type]],
        saleDate: r.saleDate.toISOString(),
        dueDate: r.dueDate?.toISOString() ?? null,
        amount: r.amount,
        openBalance: toAmount(owed),
        daysOverdue: days,
        joNumber: r.jobOrderNo,
        bucket,
        vatableSales: r.vatableSales,
        suggestedEwt: "0.00",
        suggestedVatWht: "0.00",
      };
    });

    const outstanding = open.reduce((t, r) => t + openBalanceOf(r), 0);
    const exposure = companyId
      ? companyRows.reduce((t, r) => t + openBalanceOf(r), 0)
      : outstanding;
    const limit =
      customer.creditLimit === null ? null : toCentavos(customer.creditLimit);
    const available = limit === null ? null : limit - exposure;

    return {
      customerId: customer.id,
      customerName: customer.name,
      customerAddress: customer.address,
      customerTin: customer.tin,
      invoices,
      totalOutstanding: toAmount(outstanding),
      companyId,
      companyName,
      exposure: toAmount(exposure),
      creditAvailable: available === null ? null : toAmount(available),
      overLimit: available !== null && available < 0,
      aging: formatAging(aging),
      credits: credits.map((c) => ({
        ...c,
        receivedAt: c.receivedAt.toISOString(),
      })),
      creditOnAccount: toAmount(
        credits.reduce((t, c) => t + toCentavos(c.remaining), 0)
      ),
      payments: payments.map((p) => ({
        id: p.id,
        documentNo: p.crNumber,
        documentIssued: p.documentIssued,
        amount: p.amount,
        method: p.method,
        methodDetail: p.methodDetail,
        receivedAt: p.receivedAt.toISOString(),
        createdByName: p.createdByName,
        voidType: p.voidType,
        voidReason: p.voidReason,
        voidedByName: p.voidedByName,
        replacedByDocumentNo: p.replacedByDocumentNo,
        replacesDocumentNo: p.replacesDocumentNo,
        jobOrderNo: p.jobOrderNo,
        applied: p.allocations,
        creditCreated: p.creditCreated,
        creditApplied: p.creditApplied,
      })),
      creditTermDays: customer.creditTermDays,
      creditLimit: customer.creditLimit,
      creditControlEnabled,
    };
  }

  /** Credit held for a customer — money of theirs the shop is sitting on. */
  async listCredits(
    actor: Actor,
    customerId: string
  ): Promise<CustomerCreditDto[]> {
    assertCan(actor, "read", "Sale");
    const rows = await this.credits.listAll(customerId);
    return rows.map((c) => ({ ...c, receivedAt: c.receivedAt.toISOString() }));
  }

  /**
   * Agree (or clear) a customer's credit terms.
   *
   * Gated on `maintain Maintenance` rather than a subject of its own: terms
   * and ceilings are reference data an admin sets, not something the cashier
   * taking the money decides at the counter.
   */
  async setCredit(
    actor: Actor,
    input: SetCreditInput
  ): Promise<{ id: string; name: string }> {
    assertCan(actor, "maintain", "Maintenance");

    const customer = await this.customers.setCredit(input.customerId, {
      creditTermDays: input.creditTermDays,
      creditLimit: input.creditLimit,
    });

    await this.activity.log({
      userId: actor.id,
      entityType: "Customer",
      entityId: customer.id,
      action: "set-credit",
      payload: {
        customer: customer.name,
        terms:
          input.creditTermDays === null
            ? "no terms"
            : `net ${input.creditTermDays} days`,
        limit: input.creditLimit ?? "no limit",
      },
    });

    return customer;
  }

  /**
   * Set (or clear) a customer's expanded-withholding-tax standing.
   *
   * Same gate as setCredit, and for the same reason: the rate decides what the
   * counter suggests deducting from every payment this customer makes, so it
   * is reference data an admin owns — not something the cashier taking the
   * money adjusts (R8).
   */
  async setWithholding(
    actor: Actor,
    input: SetWithholdingInput
  ): Promise<{ id: string; name: string }> {
    assertCan(actor, "maintain", "Maintenance");

    const customer = await this.customers.setWithholding(input.customerId, {
      isWithholdingAgent: input.isWithholdingAgent,
      ewtRatePct:
        input.ewtRatePct === null ? null : input.ewtRatePct.toFixed(2),
      withholdsVat: input.withholdsVat,
      // Government withholding is statutory, so flagging a customer without
      // naming a rate falls back to it rather than silently suggesting zero.
      vatWithholdingRatePct: !input.withholdsVat
        ? null
        : (input.vatWithholdingRatePct ?? Number(VAT_WITHHOLDING_RATE_PCT))
            .toFixed(2),
    });

    // Its own action, not a generic update: changing a withholding rate alters
    // what every future collection deducts, and must be reconstructable (R12).
    await this.activity.log({
      userId: actor.id,
      entityType: "Customer",
      entityId: customer.id,
      action: "set-withholding",
      payload: {
        customer: customer.name,
        withholdingAgent: input.isWithholdingAgent ? "yes" : "no",
        ewtRate:
          input.isWithholdingAgent && input.ewtRatePct !== null
            ? `${input.ewtRatePct}%`
            : "none",
        withholdsVat: input.withholdsVat ? "yes" : "no",
        vatRate: input.withholdsVat
          ? `${input.vatWithholdingRatePct ?? VAT_WITHHOLDING_RATE_PCT}%`
          : "none",
      },
    });

    return customer;
  }
}

let instance: ReceivableService | undefined;

export function getReceivableService(): ReceivableService {
  instance ??= new ReceivableService(
    new PrismaReceiptRepository(),
    new PrismaModuleFlagRepository(),
    new PrismaCustomerRepository(),
    new PrismaActivityLogRepository(),
    new PrismaCreditRepository()
  );
  return instance;
}
