import { assertCan } from "@/lib/ability";
import type { Actor } from "@/lib/authz";
import { NotFoundError } from "@/lib/errors";
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
  type StatementOfAccountDto,
} from "../schemas/receipt";
import { toAmount, toCentavos } from "./money";

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

/** Days past due, floored at 0. Null when the invoice carries no terms. */
function daysOverdueOf(dueDate: Date | null): number | null {
  if (!dueDate) return null;
  return Math.max(0, Math.floor((Date.now() - dueDate.getTime()) / 86_400_000));
}

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
    // The repository filter is a superset — invoices settled by a later
    // collection come back too, and are dropped here by their open balance.
    const open = (await this.receipts.listReceivables()).filter(
      (r) => openBalanceOf(r) > 0
    );

    // Credit held FOR customers, keyed the same way. A customer can hold
    // credit while owing nothing, so this also contributes rows of its own.
    const creditRows = await this.credits.listOpenAll();
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
        });
        continue;
      }
      const aging = emptyAging();
      let outstanding = 0;
      let oldest: number | null = null;

      for (const r of rows) {
        const owed = openBalanceOf(r);
        const days = daysOverdueOf(r.dueDate);
        outstanding += owed;
        aging[bucketFor(days)] += owed;
        if (days !== null && (oldest === null || days > oldest)) oldest = days;
      }

      const limit =
        first.customer.creditLimit === null
          ? null
          : toCentavos(first.customer.creditLimit);
      const available = limit === null ? null : limit - outstanding;

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
    customerId: string
  ): Promise<StatementOfAccountDto> {
    assertCan(actor, "read", "Sale");

    // Identity comes from the customer record, NOT from an open invoice: a
    // customer who has just paid everything off still has a statement, and
    // reading their name off a row that no longer exists produced a blank one.
    const customer = await this.customers.findById(customerId);
    if (!customer) throw new NotFoundError("Customer not found.");

    const rows = (await this.receipts.listReceivables(customerId)).filter(
      (r) => openBalanceOf(r) > 0
    );

    const aging = emptyAging();
    const invoices = rows.map((r) => {
      const owed = openBalanceOf(r);
      const days = daysOverdueOf(r.dueDate);
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
      };
    });

    return {
      customerId: customer.id,
      customerName: customer.name,
      customerAddress: customer.address,
      customerTin: customer.tin,
      asOf: new Date().toISOString(),
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

    const open = rows.filter((r) => openBalanceOf(r) > 0);
    const aging = emptyAging();
    const invoices = open.map((r) => {
      const owed = openBalanceOf(r);
      const days = daysOverdueOf(r.dueDate);
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
      };
    });

    return {
      customerId: customer.id,
      customerName: customer.name,
      customerAddress: customer.address,
      customerTin: customer.tin,
      invoices,
      totalOutstanding: toAmount(open.reduce((t, r) => t + openBalanceOf(r), 0)),
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
