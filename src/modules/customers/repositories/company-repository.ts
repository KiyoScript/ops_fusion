import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type { DbTx } from "@/modules/shared/repositories/types";
import type { AttachmentKind, VatStatus } from "@/generated/prisma/enums";
import { composePersonName, type PersonName } from "../person-name";

// Billing fields a company owns and pushes down to its contact customers.
export type CompanyBilling = {
  name: string;
  tin: string | null;
  vatStatus: VatStatus | null;
  creditTermDays: number | null;
  creditLimit: string | null;
};

export type CompanyWriteData = CompanyBilling & {
  address: string | null;
  email: string | null;
  contactNumber: string | null;
  notes: string | null;
};

export type ContactWriteData = PersonName & {
  department: string | null;
  position: string | null;
  email: string | null;
  contactNumber: string | null;
};

export type IndividualWriteData = PersonName & {
  contactNumber: string | null;
  email: string | null;
  company: string | null;
  address: string | null;
  shippingAddress: string | null;
  tin: string | null;
  vatStatus: VatStatus | null;
  creditTermDays: number | null;
  notes: string | null;
};

const listSelect = {
  id: true,
  name: true,
  tin: true,
  vatStatus: true,
  creditTermDays: true,
  createdAt: true,
  _count: { select: { contacts: true } },
} satisfies Prisma.CompanySelect;

const detailSelect = {
  id: true,
  name: true,
  tin: true,
  vatStatus: true,
  creditTermDays: true,
  creditLimit: true,
  address: true,
  email: true,
  contactNumber: true,
  notes: true,
  createdAt: true,
  createdBy: { select: { name: true } },
  contacts: {
    where: { deletedAt: null },
    select: {
      id: true, name: true, department: true, position: true,
      contactNumber: true, email: true, status: true,
    },
    orderBy: { name: "asc" },
  },
  attachments: {
    select: {
      id: true, kind: true, fileName: true, size: true, createdAt: true,
      uploadedBy: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  },
} satisfies Prisma.CompanySelect;

export type CompanyListRecord = Prisma.CompanyGetPayload<{ select: typeof listSelect }>;
export type CompanyDetailRecord = Prisma.CompanyGetPayload<{ select: typeof detailSelect }>;

export class PrismaCompanyRepository {
  withTransaction<T>(fn: (tx: DbTx) => Promise<T>): Promise<T> {
    return prisma.$transaction(fn);
  }

  async createCompany(
    data: CompanyWriteData,
    createdById: string,
    tx?: DbTx
  ): Promise<{ id: string }> {
    return (tx ?? prisma).company.create({
      data: {
        name: data.name,
        tin: data.tin,
        vatStatus: data.vatStatus,
        creditTermDays: data.creditTermDays,
        creditLimit: data.creditLimit,
        address: data.address,
        email: data.email,
        contactNumber: data.contactNumber,
        notes: data.notes,
        createdById,
      },
      select: { id: true },
    });
  }

  /** Create a contact-person Customer under a company, with the company's
   *  billing denormalized onto it (so DR/Sales readers work unchanged). */
  async createContact(
    companyId: string,
    billing: CompanyBilling,
    contact: ContactWriteData,
    createdById: string,
    tx?: DbTx
  ): Promise<{ id: string }> {
    return (tx ?? prisma).customer.create({
      data: {
        name: composePersonName(contact),
        lastName: contact.lastName,
        firstName: contact.firstName,
        middleInitial: contact.middleInitial ?? null,
        department: contact.department,
        position: contact.position,
        email: contact.email,
        contactNumber: contact.contactNumber,
        companyId,
        company: billing.name,
        tin: billing.tin,
        vatStatus: billing.vatStatus,
        vatRegistered: billing.vatStatus === "VAT", // keep the legacy flag in sync
        creditTermDays: billing.creditTermDays,
        creditLimit: billing.creditLimit,
        createdById,
      },
      select: { id: true },
    });
  }

  async createIndividual(
    data: IndividualWriteData,
    createdById: string
  ): Promise<{ id: string }> {
    return prisma.customer.create({
      data: {
        ...data,
        name: composePersonName(data),
        middleInitial: data.middleInitial ?? null,
        vatRegistered: data.vatStatus === "VAT",
        createdById,
      },
      select: { id: true },
    });
  }

  async updateCompany(
    id: string,
    data: CompanyWriteData,
    tx?: DbTx
  ): Promise<void> {
    await (tx ?? prisma).company.update({
      where: { id },
      data: {
        name: data.name,
        tin: data.tin,
        vatStatus: data.vatStatus,
        creditTermDays: data.creditTermDays,
        creditLimit: data.creditLimit,
        address: data.address,
        email: data.email,
        contactNumber: data.contactNumber,
        notes: data.notes,
      },
    });
  }

  /** Push the company's billing down to all its contact customers. */
  async syncBillingToContacts(
    companyId: string,
    billing: CompanyBilling,
    tx?: DbTx
  ): Promise<void> {
    await (tx ?? prisma).customer.updateMany({
      where: { companyId, deletedAt: null },
      data: {
        company: billing.name,
        tin: billing.tin,
        vatStatus: billing.vatStatus,
        vatRegistered: billing.vatStatus === "VAT",
        creditTermDays: billing.creditTermDays,
        creditLimit: billing.creditLimit,
      },
    });
  }

  async listPage(
    q: string | undefined,
    cursor: string | undefined,
    take: number,
    vatStatus?: VatStatus
  ): Promise<{ rows: CompanyListRecord[]; nextCursor: string | null }> {
    const where: Prisma.CompanyWhereInput = { deletedAt: null };
    if (vatStatus) where.vatStatus = vatStatus;
    if (q) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { tin: { contains: q, mode: "insensitive" } },
      ];
    }
    const rows = await prisma.company.findMany({
      where,
      select: listSelect,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    return { rows: page, nextCursor: hasMore ? page[page.length - 1]!.id : null };
  }

  async findDetail(id: string): Promise<CompanyDetailRecord | null> {
    return prisma.company.findFirst({
      where: { id, deletedAt: null },
      select: detailSelect,
    });
  }

  /** Company picker for add-customer — name/TIN match, carries billing. */
  async searchForPicker(q: string, limit = 8) {
    const rows = await prisma.company.findMany({
      where: {
        deletedAt: null,
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { tin: { contains: q, mode: "insensitive" } },
        ],
      },
      select: {
        id: true, name: true, tin: true, vatStatus: true, creditTermDays: true,
        creditLimit: true, address: true, email: true, contactNumber: true,
        _count: { select: { contacts: true } },
      },
      orderBy: { name: "asc" },
      take: limit,
    });
    return rows.map((r) => ({
      id: r.id, name: r.name, tin: r.tin, vatStatus: r.vatStatus,
      creditTermDays: r.creditTermDays, creditLimit: r.creditLimit?.toString() ?? null,
      address: r.address, email: r.email, contactNumber: r.contactNumber,
      contactCount: r._count.contacts,
    }));
  }

  /** One company in picker shape — pre-scopes the add-contact form. */
  async findPickerById(id: string) {
    const r = await prisma.company.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true, name: true, tin: true, vatStatus: true, creditTermDays: true,
        creditLimit: true, address: true, email: true, contactNumber: true,
        _count: { select: { contacts: true } },
      },
    });
    return r
      ? {
          id: r.id, name: r.name, tin: r.tin, vatStatus: r.vatStatus,
          creditTermDays: r.creditTermDays, creditLimit: r.creditLimit?.toString() ?? null,
          address: r.address, email: r.email, contactNumber: r.contactNumber,
          contactCount: r._count.contacts,
        }
      : null;
  }

  /** Billing of an existing company — reused when adding a new contact to it. */
  async getBilling(id: string): Promise<CompanyBilling | null> {
    const c = await prisma.company.findFirst({
      where: { id, deletedAt: null },
      select: { name: true, tin: true, vatStatus: true, creditTermDays: true, creditLimit: true },
    });
    return c
      ? {
          name: c.name, tin: c.tin, vatStatus: c.vatStatus,
          creditTermDays: c.creditTermDays,
          creditLimit: c.creditLimit?.toString() ?? null,
        }
      : null;
  }

  async findByName(name: string): Promise<{ id: string } | null> {
    return prisma.company.findFirst({
      where: { deletedAt: null, name: { equals: name, mode: "insensitive" } },
      select: { id: true },
    });
  }

  /** Company name search with contacts — feeds inquiry/quotation pickers. */
  async search(q: string, limit = 10): Promise<
    { id: string; name: string; contacts: { id: string; name: string; department: string | null; position: string | null }[] }[]
  > {
    return prisma.company.findMany({
      where: { deletedAt: null, name: { contains: q, mode: "insensitive" } },
      select: {
        id: true,
        name: true,
        contacts: {
          where: { deletedAt: null, status: "ACTIVE" },
          select: { id: true, name: true, department: true, position: true },
          orderBy: { name: "asc" },
        },
      },
      orderBy: { name: "asc" },
      take: limit,
    });
  }

  async softDelete(id: string): Promise<void> {
    await prisma.company.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  // ——— attachments ———
  async addAttachment(
    target: { companyId?: string; customerId?: string },
    file: { kind: AttachmentKind; fileName: string; mimeType: string; size: number; data: Uint8Array },
    uploadedById: string
  ): Promise<{ id: string }> {
    return prisma.customerAttachment.create({
      data: {
        companyId: target.companyId ?? null,
        customerId: target.customerId ?? null,
        kind: file.kind,
        fileName: file.fileName,
        mimeType: file.mimeType,
        size: file.size,
        data: Buffer.from(file.data),
        uploadedById,
      },
      select: { id: true },
    });
  }

  async getAttachmentFile(
    id: string
  ): Promise<{ fileName: string; mimeType: string; data: Uint8Array } | null> {
    const row = await prisma.customerAttachment.findUnique({
      where: { id },
      select: { fileName: true, mimeType: true, data: true },
    });
    return row ? { fileName: row.fileName, mimeType: row.mimeType, data: row.data } : null;
  }

  async deleteAttachment(id: string): Promise<void> {
    await prisma.customerAttachment.delete({ where: { id } });
  }
}
