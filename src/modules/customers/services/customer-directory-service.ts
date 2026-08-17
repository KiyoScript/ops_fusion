import { NotFoundError } from "@/lib/errors";
import type { Actor } from "@/lib/authz";
import { assertCan } from "@/lib/ability";
import type { IActivityLogRepository } from "@/modules/shared/repositories/activity-log-repository";
import { PrismaActivityLogRepository } from "@/modules/shared/repositories/activity-log-repository";
import type {
  CustomerDetailRecord,
  CustomerListRecord,
  ICustomerDirectoryRepository,
} from "../repositories/customer-directory-repository";
import { PrismaCustomerDirectoryRepository } from "../repositories/customer-directory-repository";
import type { Prisma } from "@/generated/prisma/client";
import type {
  CustomerDetailDto,
  CustomerEditDto,
  CustomerFinancialTotals,
  CustomerListFilters,
  CustomerListPageDto,
  CustomerListRowDto,
  CustomerUpdateInput,
  DuplicateNameMatch,
} from "../schemas/customer";
import { composePersonName, type PersonName } from "../person-name";

export class CustomerDirectoryService {
  constructor(
    private readonly customers: ICustomerDirectoryRepository,
    private readonly activity: IActivityLogRepository
  ) {}

  // Every read below is gated (docs/sales-contract.md R9). These rows carry
  // credit limits, TINs, VAT standing and full sales history — the customer's
  // credit file, not a phone book — and `read Customer` is what the policy
  // grants for it. Taking the actor and never checking it was the gap.

  async list(actor: Actor, filters: CustomerListFilters): Promise<CustomerListPageDto> {
    assertCan(actor, "read", "Customer");
    const { rows, nextCursor } = await this.customers.listPage(filters);
    return { rows: rows.map(mapListRow), nextCursor };
  }

  getMetrics(actor: Actor) {
    assertCan(actor, "read", "Customer");
    return this.customers.getMetrics();
  }

  async get(actor: Actor, id: string): Promise<CustomerDetailDto> {
    assertCan(actor, "read", "Customer");
    const [c, totals] = await Promise.all([
      this.customers.findDetail(id),
      this.customers.getFinancialTotals(id),
    ]);
    if (!c) throw new NotFoundError("Customer not found.");
    return mapDetail(c, totals);
  }

  async getForEdit(actor: Actor, id: string): Promise<CustomerEditDto> {
    assertCan(actor, "read", "Customer");
    const c = await this.customers.findForEdit(id);
    if (!c) throw new NotFoundError("Customer not found.");
    return {
      id: c.id, name: c.name,
      lastName: c.lastName, firstName: c.firstName, middleInitial: c.middleInitial,
      company: c.company, companyId: c.companyId,
      department: c.department, position: c.position,
      contactNumber: c.contactNumber, email: c.email, address: c.address,
      shippingAddress: c.shippingAddress, tin: c.tin, vatStatus: c.vatStatus,
      creditTermDays: c.creditTermDays, status: c.status, notes: c.notes,
    };
  }

  /** Non-blocking soft-duplicate check: existing customers with the same
   *  composed name. Used by the create/edit forms to warn (never to reject). */
  async checkDuplicateName(
    actor: Actor,
    input: PersonName & { excludeId?: string }
  ): Promise<DuplicateNameMatch[]> {
    assertCan(actor, "read", "Customer");
    const name = composePersonName(input);
    if (!name) return [];
    return this.customers.findNameMatches(name, input.excludeId);
  }

  async update(actor: Actor, input: CustomerUpdateInput): Promise<void> {
    assertCan(actor, "update", "Customer");
    const existing = await this.customers.findForEdit(input.id);
    if (!existing) throw new NotFoundError("Customer not found.");

    // Tax standing is snapshotted onto every receipt at issue (billedToTin,
    // and the VAT split that follows from vatStatus), so moving it changes what
    // the NEXT document says about this customer and nothing about the ones
    // already filed. That is a BIR-relevant event and gets its own log action
    // rather than being buried in a generic "update"
    // (docs/sales-contract.md R12).
    const isContact = existing.companyId !== null;
    const taxMoved =
      !isContact &&
      ((input.tin || null) !== existing.tin ||
        (input.vatStatus ?? null) !== existing.vatStatus);

    await this.customers.update(input, isContact);
    await this.activity.log({
      userId: actor.id,
      entityType: "Customer",
      entityId: input.id,
      action: "update",
      payload: { name: composePersonName(input) },
    });
    if (taxMoved) {
      await this.activity.log({
        userId: actor.id,
        entityType: "Customer",
        entityId: input.id,
        action: "change-tax-status",
        payload: {
          name: composePersonName(input),
          from: { tin: existing.tin, vatStatus: existing.vatStatus },
          to: { tin: input.tin || null, vatStatus: input.vatStatus ?? null },
        },
      });
    }
  }
}

function mapListRow(c: CustomerListRecord): CustomerListRowDto {
  return {
    id: c.id,
    name: c.name,
    company: c.company,
    companyId: c.companyId,
    contactNumber: c.contactNumber,
    email: c.email,
    tin: c.tin,
    status: c.status,
    vatStatus: c.vatStatus,
    creditTermDays: c.creditTermDays,
    creditLimit: c.creditLimit?.toString() ?? null,
    quotationCount: c._count.quotations,
    jobOrderCount: c._count.jobOrders,
    createdAt: c.createdAt.toISOString(),
  };
}

function mapDetail(
  c: CustomerDetailRecord,
  totals: CustomerFinancialTotals
): CustomerDetailDto {
  return {
    totals,
    id: c.id,
    name: c.name,
    company: c.company,
    companyId: c.companyId,
    department: c.department,
    position: c.position,
    contactNumber: c.contactNumber,
    email: c.email,
    address: c.address,
    shippingAddress: c.shippingAddress,
    tin: c.tin,
    status: c.status,
    vatStatus: c.vatStatus,
    creditTermDays: c.creditTermDays,
    creditLimit: c.creditLimit?.toString() ?? null,
    notes: c.notes,
    createdByName: c.createdBy.name,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    counts: {
      quotations: c._count.quotations,
      jobOrders: c._count.jobOrders,
      deliveryReceipts: c._count.deliveryReceipts,
      sales: c._count.sales,
      collectionReceipts: c._count.collectionReceipts,
      advancePayments: c._count.advancePayments,
      inquiries: c._count.inquiries,
    },
    attachments: c.attachments.map((a) => ({
      id: a.id, kind: a.kind, fileName: a.fileName, size: a.size,
      createdAt: a.createdAt.toISOString(), uploadedByName: a.uploadedBy.name,
    })),
    quotations: c.quotations.map((q) => ({
      id: q.id, number: q.quoteNumber, status: q.status,
      total: q.total.toString(), createdAt: q.createdAt.toISOString(),
      summary: q.items.map((i) => i.description).join(" · "),
      itemCount: q.items.length,
    })),
    jobOrders: c.jobOrders.map((j) => ({
      id: j.id, number: j.joNumber, status: j.status,
      total: j.total.toString(), createdAt: j.createdAt.toISOString(),
      summary: j.items.map((i) => i.description).join(" · "),
      itemCount: j.items.length,
    })),
    deliveries: c.deliveryReceipts.map((dr) => ({
      id: dr.id, number: dr.drNumber, status: dr.status, issuedAt: dr.issuedAt.toISOString(),
      summary: dr.lines.map((l) => `${l.qty}× ${l.jobOrderItem.description}`).join(" · "),
      itemCount: dr.lines.length,
    })),
    sales: c.sales.map((s) => {
      // R3: what is still owed is the arithmetic, never the status flag.
      const owed = Math.max(
        cents(s.amount) - cents(s.amountPaid) - cents(s.settledAmount),
        0
      );
      return {
        id: s.id,
        documentNo: s.documentNo,
        type: s.type,
        paymentStatus: s.paymentStatus,
        amount: s.amount.toString(),
        openBalance: pesos(owed),
        vatAmount: s.vatAmount.toString(),
        dueDate: s.dueDate?.toISOString() ?? null,
        daysOverdue:
          s.dueDate && owed > 0
            ? Math.max(
                0,
                Math.floor((Date.now() - s.dueDate.getTime()) / 86_400_000)
              )
            : null,
        saleDate: s.saleDate.toISOString(),
      };
    }),
    collections: c.collectionReceipts.map((cr) => ({
      id: cr.id, number: cr.crNumber, documentIssued: cr.documentIssued,
      amount: cr.amount.toString(), method: cr.method,
      receivedAt: cr.receivedAt.toISOString(),
    })),
    advancePayments: c.advancePayments.map((ap) => ({
      id: ap.id,
      amount: ap.amount.toString(),
      // R6: `remaining` is what the customer can still spend. Showing the
      // original amount promises credit that may already be gone.
      remaining: pesos(
        Math.max(
          cents(ap.amount) -
            ap.applications.reduce((t, a) => t + cents(a.amount), 0),
          0
        )
      ),
      status: ap.status,
      receivedAt: ap.receivedAt.toISOString(),
    })),
  };
}

// Money crosses this boundary as decimal strings; comparisons and sums happen
// in integer centavos so no float ever touches a peso (R1).
const cents = (v: Prisma.Decimal) => Math.round(Number(v) * 100);
const pesos = (c: number) =>
  `${Math.floor(c / 100)}.${String(Math.abs(c) % 100).padStart(2, "0")}`;

let instance: CustomerDirectoryService | undefined;

export function getCustomerDirectoryService(): CustomerDirectoryService {
  instance ??= new CustomerDirectoryService(
    new PrismaCustomerDirectoryRepository(),
    new PrismaActivityLogRepository()
  );
  return instance;
}
