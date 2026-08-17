import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type {
  CustomerFinancialTotals,
  CustomerListFilters,
  CustomerMetricsDto,
  CustomerUpdateInput,
  DuplicateNameMatch,
} from "../schemas/customer";
import { composePersonName } from "../person-name";

// ── financial row filters (docs/sales-contract.md R2) ──────────────────────
//
// A voided receipt is not a deleted one: it keeps its row and its serial so the
// booklet stays accountable, and it stops counting as revenue. Anything on this
// page that presents money must therefore exclude BOTH — a cancelled invoice
// shown next to a live one reads as revenue that was never earned.
//
// Defined once and reused by every financial select AND its _count, because the
// failure mode of getting it right in one and not the other is a page whose
// tab badge disagrees with the table underneath it.
const LIVE_RECEIPT = { deletedAt: null, voidedAt: null } as const;
const LIVE_CREDIT = { deletedAt: null } as const;

const editSelect = {
  id: true,
  name: true,
  lastName: true,
  firstName: true,
  middleInitial: true,
  company: true,
  companyId: true,
  department: true,
  position: true,
  contactNumber: true,
  email: true,
  address: true,
  shippingAddress: true,
  tin: true,
  vatStatus: true,
  creditTermDays: true,
  status: true,
  notes: true,
} satisfies Prisma.CustomerSelect;

export type CustomerEditRecord = Prisma.CustomerGetPayload<{ select: typeof editSelect }>;

const listSelect = {
  id: true,
  name: true,
  company: true,
  companyId: true,
  contactNumber: true,
  email: true,
  tin: true,
  status: true,
  vatStatus: true,
  creditTermDays: true,
  creditLimit: true,
  createdAt: true,
  _count: { select: { quotations: true, jobOrders: true } },
} satisfies Prisma.CustomerSelect;

const detailSelect = {
  id: true,
  name: true,
  company: true,
  companyId: true,
  department: true,
  position: true,
  contactNumber: true,
  email: true,
  address: true,
  shippingAddress: true,
  tin: true,
  status: true,
  vatStatus: true,
  creditTermDays: true,
  creditLimit: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { name: true } },
  attachments: {
    select: {
      id: true, kind: true, fileName: true, size: true, createdAt: true,
      uploadedBy: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  },
  // Financial relations are counted with the SAME filter their lists use. A
  // bare `sales: true` counts cancelled receipts, so a customer with one live
  // invoice and four voided ones reads "5 sales" — see docs/sales-contract.md R2.
  _count: {
    select: {
      quotations: true,
      jobOrders: true,
      deliveryReceipts: true,
      sales: { where: LIVE_RECEIPT },
      collectionReceipts: { where: LIVE_RECEIPT },
      advancePayments: { where: LIVE_CREDIT },
      inquiries: true,
    },
  },
  quotations: {
    select: {
      id: true, quoteNumber: true, status: true, total: true, createdAt: true,
      items: { select: { description: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  },
  jobOrders: {
    select: {
      id: true, joNumber: true, status: true, total: true, createdAt: true,
      items: { select: { description: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  },
  deliveryReceipts: {
    select: {
      id: true, drNumber: true, status: true, issuedAt: true,
      lines: { select: { qty: true, jobOrderItem: { select: { description: true } } } },
    },
    orderBy: { issuedAt: "desc" },
    take: 50,
  },
  sales: {
    where: LIVE_RECEIPT,
    // amountPaid + settledAmount are what make an open balance computable:
    // `amount − amountPaid − settledAmount` (R3). paymentStatus alone cannot
    // answer it — a settled charge invoice stays UNPAID by design, because the
    // printed receipt is a legal record that must not be rewritten.
    select: {
      id: true, documentNo: true, type: true, paymentStatus: true,
      amount: true, amountPaid: true, settledAmount: true,
      vatableSales: true, vatAmount: true, dueDate: true, saleDate: true,
    },
    orderBy: { saleDate: "desc" },
    take: 50,
  },
  collectionReceipts: {
    where: LIVE_RECEIPT,
    select: { id: true, crNumber: true, documentIssued: true, amount: true, method: true, receivedAt: true },
    orderBy: { receivedAt: "desc" },
    take: 50,
  },
  advancePayments: {
    where: LIVE_CREDIT,
    // `applications` yields `remaining` — what the customer can actually still
    // spend. Reporting the raw `amount` tells a customer they hold credit the
    // shop has already applied (R6).
    select: {
      id: true, amount: true, status: true, receivedAt: true,
      applications: { select: { amount: true } },
    },
    orderBy: { receivedAt: "desc" },
    take: 50,
  },
} satisfies Prisma.CustomerSelect;

export type CustomerListRecord = Prisma.CustomerGetPayload<{ select: typeof listSelect }>;
export type CustomerDetailRecord = Prisma.CustomerGetPayload<{ select: typeof detailSelect }>;

export interface ICustomerDirectoryRepository {
  listPage(
    filter: CustomerListFilters
  ): Promise<{ rows: CustomerListRecord[]; nextCursor: string | null }>;
  findDetail(id: string): Promise<CustomerDetailRecord | null>;
  getFinancialTotals(customerId: string): Promise<CustomerFinancialTotals>;
  findForEdit(id: string): Promise<CustomerEditRecord | null>;
  update(input: CustomerUpdateInput, isCompanyContact: boolean): Promise<void>;
  findNameMatches(name: string, excludeId?: string): Promise<DuplicateNameMatch[]>;
  getMetrics(): Promise<CustomerMetricsDto>;
}

export class PrismaCustomerDirectoryRepository
  implements ICustomerDirectoryRepository
{
  async listPage(
    filter: CustomerListFilters
  ): Promise<{ rows: CustomerListRecord[]; nextCursor: string | null }> {
    const where: Prisma.CustomerWhereInput = { deletedAt: null };
    if (filter.status) where.status = filter.status;
    if (filter.vatStatus) where.vatStatus = filter.vatStatus;
    if (filter.individualsOnly) where.companyId = null;
    if (filter.q) {
      where.OR = [
        { name: { contains: filter.q, mode: "insensitive" } },
        { company: { contains: filter.q, mode: "insensitive" } },
        { contactNumber: { contains: filter.q, mode: "insensitive" } },
        { email: { contains: filter.q, mode: "insensitive" } },
        { tin: { contains: filter.q, mode: "insensitive" } },
      ];
    }
    const rows = await prisma.customer.findMany({
      where,
      select: listSelect,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: filter.take + 1,
      ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > filter.take;
    const page = hasMore ? rows.slice(0, filter.take) : rows;
    return { rows: page, nextCursor: hasMore ? page[page.length - 1]!.id : null };
  }

  async findDetail(id: string): Promise<CustomerDetailRecord | null> {
    return prisma.customer.findFirst({
      where: { id, deletedAt: null },
      select: detailSelect,
    });
  }

  /**
   * Lifetime money for one customer, aggregated in SQL over EVERY document.
   *
   * The document lists above are capped at `take: 50` so the activity tabs stay
   * cheap. Summing those lists in the component would produce a total that
   * silently means "of the 50 most recent" — which for a long-standing customer
   * is simply a wrong number, and wrong in a direction nobody notices
   * (docs/sales-contract.md R7). So the totals come from here instead.
   *
   * Deliberately derived from `Sale` alone (R4/R5): revenue is booked by
   * invoices, and a CollectionReceipt is cash arriving against revenue that was
   * already booked. Summing collections into a "collected" figure double-counts
   * every peso paid by applying existing customer credit, because that credit
   * was never cash crossing the counter.
   */
  async getFinancialTotals(customerId: string): Promise<CustomerFinancialTotals> {
    const [live, voided] = await Promise.all([
      prisma.sale.aggregate({
        where: { customerId, ...LIVE_RECEIPT },
        _sum: { amount: true, amountPaid: true, settledAmount: true, vatAmount: true },
        _count: true,
      }),
      prisma.sale.count({
        // contract:allow R2 — counting the voided ones IS the point of this figure
        where: { customerId, deletedAt: null, NOT: { voidedAt: null } },
      }),
    ]);

    const cents = (v: Prisma.Decimal | null) =>
      v === null ? 0 : Math.round(Number(v) * 100);
    const money = (c: number) =>
      `${Math.floor(c / 100)}.${String(Math.abs(c) % 100).padStart(2, "0")}`;

    const billed = cents(live._sum.amount);
    // What actually landed against their invoices: taken at the counter
    // (amountPaid, frozen on the printed receipt) plus collected afterwards
    // (settledAmount). Their sum is the only honest "received" figure.
    const received = cents(live._sum.amountPaid) + cents(live._sum.settledAmount);

    return {
      lifetimeBilled: money(billed),
      lifetimeReceived: money(received),
      openBalance: money(Math.max(billed - received, 0)),
      lifetimeVat: money(cents(live._sum.vatAmount)),
      documentCount: live._count,
      voidedCount: voided,
    };
  }

  async findForEdit(id: string): Promise<CustomerEditRecord | null> {
    return prisma.customer.findFirst({
      where: { id, deletedAt: null },
      select: editSelect,
    });
  }

  async update(input: CustomerUpdateInput, isCompanyContact: boolean): Promise<void> {
    await prisma.customer.update({
      where: { id: input.id },
      data: {
        name: composePersonName(input),
        lastName: input.lastName,
        firstName: input.firstName,
        middleInitial: input.middleInitial ?? null,
        contactNumber: input.contactNumber || null,
        email: input.email || null,
        address: input.address || null,
        shippingAddress: input.shippingAddress || null,
        department: input.department || null,
        position: input.position || null,
        status: input.status,
        notes: input.notes || null,
        // Billing is company-owned for contacts (kept in sync from the
        // company); only individuals edit it on their own record.
        //
        // `creditTermDays` / `creditLimit` are deliberately ABSENT from both
        // branches. This path is gated on `update Customer`, which ENCODER
        // holds — the cashier at the counter. Credit terms and ceilings are
        // admin reference data and move only through
        // ReceivableService.setCredit, which gates on `maintain Maintenance`
        // (docs/sales-contract.md R8). Adding them back here would let the
        // person about to issue a charge invoice raise the ceiling that exists
        // to stop them.
        ...(isCompanyContact
          ? {}
          : {
              company: input.company || null,
              tin: input.tin || null,
              vatStatus: input.vatStatus ?? null,
              vatRegistered: input.vatStatus === "VAT",
            }),
      },
    });
  }

  /** Existing customers whose composed name equals `name` (case-insensitive) —
   *  drives the soft duplicate warning. Never blocks; just surfaces matches. */
  async findNameMatches(name: string, excludeId?: string): Promise<DuplicateNameMatch[]> {
    const rows = await prisma.customer.findMany({
      where: {
        deletedAt: null,
        name: { equals: name, mode: "insensitive" },
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
      },
      select: {
        id: true, name: true, company: true, companyId: true,
        status: true, createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
    return rows.map((r) => ({
      id: r.id, name: r.name, company: r.company, companyId: r.companyId,
      status: r.status, createdAt: r.createdAt.toISOString(),
    }));
  }

  async getMetrics(): Promise<CustomerMetricsDto> {
    const active = { deletedAt: null } as const;
    const [companies, individuals, contacts, vat, nonVat, noTin, withTerms, activeCount] =
      await Promise.all([
        prisma.company.count({ where: { deletedAt: null } }),
        prisma.customer.count({ where: { ...active, companyId: null } }),
        prisma.customer.count({ where: { ...active, NOT: { companyId: null } } }),
        prisma.customer.count({ where: { ...active, vatStatus: "VAT" } }),
        prisma.customer.count({ where: { ...active, vatStatus: "NON_VAT" } }),
        prisma.customer.count({ where: { ...active, vatStatus: "NO_TIN" } }),
        prisma.customer.count({ where: { ...active, NOT: { creditTermDays: null } } }),
        prisma.customer.count({ where: { ...active, status: "ACTIVE" } }),
      ]);
    const totalCustomers = individuals + contacts;
    return {
      companies, individuals, contacts, totalCustomers,
      vat, nonVat, noTin, withTerms,
      active: activeCount, inactive: totalCustomers - activeCount,
    };
  }
}
