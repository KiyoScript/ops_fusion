import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type {
  CustomerListFilters,
  CustomerMetricsDto,
  CustomerUpdateInput,
} from "../schemas/customer";

const editSelect = {
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
  _count: {
    select: {
      quotations: true,
      jobOrders: true,
      deliveryReceipts: true,
      sales: true,
      collectionReceipts: true,
      advancePayments: true,
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
    select: { id: true, documentNo: true, paymentStatus: true, amount: true, saleDate: true },
    orderBy: { saleDate: "desc" },
    take: 50,
  },
  collectionReceipts: {
    select: { id: true, crNumber: true, amount: true, receivedAt: true },
    orderBy: { receivedAt: "desc" },
    take: 50,
  },
  advancePayments: {
    select: { id: true, amount: true, status: true, receivedAt: true },
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
  findForEdit(id: string): Promise<CustomerEditRecord | null>;
  update(input: CustomerUpdateInput, isCompanyContact: boolean): Promise<void>;
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
        name: input.name,
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
        ...(isCompanyContact
          ? {}
          : {
              company: input.company || null,
              tin: input.tin || null,
              vatStatus: input.vatStatus ?? null,
              vatRegistered: input.vatStatus === "VAT",
              creditTermDays: input.creditTermDays ?? null,
            }),
      },
    });
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
