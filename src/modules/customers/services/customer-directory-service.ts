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
import type {
  CustomerDetailDto,
  CustomerEditDto,
  CustomerListFilters,
  CustomerListPageDto,
  CustomerListRowDto,
  CustomerUpdateInput,
} from "../schemas/customer";

export class CustomerDirectoryService {
  constructor(
    private readonly customers: ICustomerDirectoryRepository,
    private readonly activity: IActivityLogRepository
  ) {}

  async list(_actor: Actor, filters: CustomerListFilters): Promise<CustomerListPageDto> {
    const { rows, nextCursor } = await this.customers.listPage(filters);
    return { rows: rows.map(mapListRow), nextCursor };
  }

  async get(_actor: Actor, id: string): Promise<CustomerDetailDto> {
    const c = await this.customers.findDetail(id);
    if (!c) throw new NotFoundError("Customer not found.");
    return mapDetail(c);
  }

  async getForEdit(_actor: Actor, id: string): Promise<CustomerEditDto> {
    const c = await this.customers.findForEdit(id);
    if (!c) throw new NotFoundError("Customer not found.");
    return {
      id: c.id, name: c.name, company: c.company, contactNumber: c.contactNumber,
      email: c.email, address: c.address, shippingAddress: c.shippingAddress,
      tin: c.tin, vatRegistered: c.vatRegistered, status: c.status, notes: c.notes,
    };
  }

  async update(actor: Actor, input: CustomerUpdateInput): Promise<void> {
    assertCan(actor, "update", "Customer");
    const existing = await this.customers.findForEdit(input.id);
    if (!existing) throw new NotFoundError("Customer not found.");
    await this.customers.update(input);
    await this.activity.log({
      userId: actor.id,
      entityType: "Customer",
      entityId: input.id,
      action: "update",
      payload: { name: input.name },
    });
  }
}

function mapListRow(c: CustomerListRecord): CustomerListRowDto {
  return {
    id: c.id,
    name: c.name,
    company: c.company,
    contactNumber: c.contactNumber,
    email: c.email,
    tin: c.tin,
    status: c.status,
    vatRegistered: c.vatRegistered,
    creditTermDays: c.creditTermDays,
    creditLimit: c.creditLimit?.toString() ?? null,
    quotationCount: c._count.quotations,
    jobOrderCount: c._count.jobOrders,
    createdAt: c.createdAt.toISOString(),
  };
}

function mapDetail(c: CustomerDetailRecord): CustomerDetailDto {
  return {
    id: c.id,
    name: c.name,
    company: c.company,
    contactNumber: c.contactNumber,
    email: c.email,
    address: c.address,
    shippingAddress: c.shippingAddress,
    tin: c.tin,
    status: c.status,
    vatRegistered: c.vatRegistered,
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
    quotations: c.quotations.map((q) => ({
      id: q.id, number: q.quoteNumber, status: q.status,
      total: q.total.toString(), createdAt: q.createdAt.toISOString(),
    })),
    jobOrders: c.jobOrders.map((j) => ({
      id: j.id, number: j.joNumber, status: j.status,
      total: j.total.toString(), createdAt: j.createdAt.toISOString(),
    })),
    deliveries: c.deliveryReceipts.map((dr) => ({
      id: dr.id, number: dr.drNumber, status: dr.status, issuedAt: dr.issuedAt.toISOString(),
    })),
    sales: c.sales.map((s) => ({
      id: s.id, documentNo: s.documentNo, paymentStatus: s.paymentStatus,
      amount: s.amount.toString(), saleDate: s.saleDate.toISOString(),
    })),
    collections: c.collectionReceipts.map((cr) => ({
      id: cr.id, number: cr.crNumber, amount: cr.amount.toString(),
      receivedAt: cr.receivedAt.toISOString(),
    })),
    advancePayments: c.advancePayments.map((ap) => ({
      id: ap.id, amount: ap.amount.toString(), status: ap.status,
      receivedAt: ap.receivedAt.toISOString(),
    })),
  };
}

let instance: CustomerDirectoryService | undefined;

export function getCustomerDirectoryService(): CustomerDirectoryService {
  instance ??= new CustomerDirectoryService(
    new PrismaCustomerDirectoryRepository(),
    new PrismaActivityLogRepository()
  );
  return instance;
}
