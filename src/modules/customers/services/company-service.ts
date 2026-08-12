import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { type Actor } from "@/lib/authz";
import { assertCan } from "@/lib/ability";
import type { AttachmentKind, VatStatus } from "@/generated/prisma/enums";
import type { IActivityLogRepository } from "@/modules/shared/repositories/activity-log-repository";
import { PrismaActivityLogRepository } from "@/modules/shared/repositories/activity-log-repository";
import {
  PrismaCompanyRepository,
  type CompanyBilling,
  type CompanyDetailRecord,
  type CompanyListRecord,
} from "../repositories/company-repository";
import type {
  AddCustomerInput,
  CompanyDetailDto,
  CompanyListRowDto,
  CompanyPickerDto,
  CompanySearchDto,
  CompanyUpdateInput,
} from "../schemas/company";

export class CompanyService {
  constructor(
    private readonly repo: PrismaCompanyRepository,
    private readonly activity: IActivityLogRepository
  ) {}

  /** The add-customer flow: create a company + its first contact, or an
   *  individual customer. Returns the created CUSTOMER id (the person). */
  async addCustomer(
    actor: Actor,
    input: AddCustomerInput
  ): Promise<{ customerId: string; companyId: string | null }> {
    assertCan(actor, "create", "Customer");

    if (input.kind === "INDIVIDUAL") {
      const { id } = await this.repo.createIndividual(
        {
          name: input.name,
          contactNumber: input.contactNumber,
          email: input.email ?? null,
          company: input.company ?? null,
          address: input.address ?? null,
          shippingAddress: input.shippingAddress ?? null,
          tin: input.tin ?? null,
          vatStatus: input.vatStatus ?? null,
          creditTermDays: input.creditTermDays ?? null,
          notes: input.notes ?? null,
        },
        actor.id
      );
      await this.activity.log({
        userId: actor.id, entityType: "Customer", entityId: id,
        action: "create", payload: { name: input.name, kind: "individual" },
      });
      return { customerId: id, companyId: null };
    }

    // COMPANY, adding a contact to an EXISTING company — reuse its billing.
    if (input.companyId) {
      const billing = await this.repo.getBilling(input.companyId);
      if (!billing) throw new NotFoundError("Company not found.");
      const contact = await this.repo.createContact(
        input.companyId,
        billing,
        {
          name: input.contact.name,
          department: input.contact.department,
          position: input.contact.position,
          email: input.contact.email,
          contactNumber: input.contact.contactNumber,
        },
        actor.id
      );
      await this.activity.log({
        userId: actor.id, entityType: "Company", entityId: input.companyId,
        action: "add-contact", payload: { contact: input.contact.name },
      });
      return { customerId: contact.id, companyId: input.companyId };
    }

    // COMPANY, creating a NEW company + its first contact atomically.
    const co = input.company;
    if (!co) {
      throw new ValidationError("Company details are required.");
    }
    if (await this.repo.findByName(co.name)) {
      throw new ConflictError(`A company named "${co.name}" already exists.`);
    }
    const billing: CompanyBilling = {
      name: co.name,
      tin: co.tin,
      vatStatus: co.vatStatus ?? null,
      creditTermDays: co.creditTermDays ?? null,
      creditLimit: co.creditLimit !== undefined ? co.creditLimit.toFixed(2) : null,
    };
    const result = await this.repo.withTransaction(async (tx) => {
      const company = await this.repo.createCompany(
        {
          ...billing,
          address: co.address ?? null,
          email: co.email ?? null,
          contactNumber: co.contactNumber ?? null,
          notes: co.notes ?? null,
        },
        actor.id,
        tx
      );
      const contact = await this.repo.createContact(
        company.id,
        billing,
        {
          name: input.contact.name,
          department: input.contact.department,
          position: input.contact.position,
          email: input.contact.email,
          contactNumber: input.contact.contactNumber,
        },
        actor.id,
        tx
      );
      return { companyId: company.id, customerId: contact.id };
    });
    await this.activity.log({
      userId: actor.id, entityType: "Company", entityId: result.companyId,
      action: "create", payload: { name: co.name, firstContact: input.contact.name },
    });
    return result;
  }

  async list(
    _actor: Actor,
    q: string | undefined,
    cursor: string | undefined,
    take: number,
    vatStatus?: VatStatus
  ): Promise<{ rows: CompanyListRowDto[]; nextCursor: string | null }> {
    const { rows, nextCursor } = await this.repo.listPage(q, cursor, take, vatStatus);
    return { rows: rows.map(mapListRow), nextCursor };
  }

  async getDetail(_actor: Actor, id: string): Promise<CompanyDetailDto> {
    const c = await this.repo.findDetail(id);
    if (!c) throw new NotFoundError("Company not found.");
    return mapDetail(c);
  }

  async search(_actor: Actor, q: string): Promise<CompanySearchDto[]> {
    if (!q.trim()) return [];
    return this.repo.search(q.trim());
  }

  /** Company picker for the add-customer flow (carries billing to auto-fill). */
  async searchForAdd(_actor: Actor, q: string): Promise<CompanyPickerDto[]> {
    if (!q.trim()) return [];
    return this.repo.searchForPicker(q.trim());
  }

  /** One company in picker shape — pre-scopes the add-contact form. */
  async getPicker(_actor: Actor, id: string): Promise<CompanyPickerDto | null> {
    return this.repo.findPickerById(id);
  }

  async update(actor: Actor, input: CompanyUpdateInput): Promise<void> {
    assertCan(actor, "update", "Customer");
    const billing: CompanyBilling = {
      name: input.name,
      tin: input.tin,
      vatStatus: input.vatStatus ?? null,
      creditTermDays: input.creditTermDays ?? null,
      creditLimit: input.creditLimit !== undefined ? input.creditLimit.toFixed(2) : null,
    };
    await this.repo.withTransaction(async (tx) => {
      await this.repo.updateCompany(
        input.id,
        {
          ...billing,
          address: input.address ?? null,
          email: input.email ?? null,
          contactNumber: input.contactNumber ?? null,
          notes: input.notes ?? null,
        },
        tx
      );
      // Keep every contact's denormalized billing in step with the company.
      await this.repo.syncBillingToContacts(input.id, billing, tx);
    });
    await this.activity.log({
      userId: actor.id, entityType: "Company", entityId: input.id,
      action: "update", payload: { name: input.name },
    });
  }

  // ——— attachments (Credit Request / BIR 2303 / other) ———
  async addAttachment(
    actor: Actor,
    target: { companyId?: string; customerId?: string },
    file: { kind: AttachmentKind; fileName: string; mimeType: string; size: number; data: Uint8Array }
  ): Promise<{ id: string }> {
    assertCan(actor, "update", "Customer");
    const created = await this.repo.addAttachment(target, file, actor.id);
    await this.activity.log({
      userId: actor.id,
      entityType: target.companyId ? "Company" : "Customer",
      entityId: target.companyId ?? target.customerId ?? created.id,
      action: "attach", payload: { kind: file.kind, fileName: file.fileName },
    });
    return created;
  }

  getAttachmentFile(id: string) {
    return this.repo.getAttachmentFile(id);
  }

  async removeAttachment(actor: Actor, id: string): Promise<void> {
    assertCan(actor, "update", "Customer");
    await this.repo.deleteAttachment(id);
    await this.activity.log({
      userId: actor.id, entityType: "CustomerAttachment", entityId: id,
      action: "delete", payload: {},
    });
  }
}

function mapListRow(c: CompanyListRecord): CompanyListRowDto {
  return {
    id: c.id,
    name: c.name,
    tin: c.tin,
    vatStatus: c.vatStatus,
    creditTermDays: c.creditTermDays,
    contactCount: c._count.contacts,
    createdAt: c.createdAt.toISOString(),
  };
}

function mapDetail(c: CompanyDetailRecord): CompanyDetailDto {
  return {
    id: c.id,
    name: c.name,
    tin: c.tin,
    vatStatus: c.vatStatus,
    creditTermDays: c.creditTermDays,
    creditLimit: c.creditLimit?.toString() ?? null,
    address: c.address,
    email: c.email,
    contactNumber: c.contactNumber,
    notes: c.notes,
    createdByName: c.createdBy.name,
    createdAt: c.createdAt.toISOString(),
    contacts: c.contacts.map((ct) => ({
      id: ct.id, name: ct.name, department: ct.department, position: ct.position,
      contactNumber: ct.contactNumber, email: ct.email, status: ct.status,
    })),
    attachments: c.attachments.map((a) => ({
      id: a.id, kind: a.kind, fileName: a.fileName, size: a.size,
      createdAt: a.createdAt.toISOString(), uploadedByName: a.uploadedBy.name,
    })),
  };
}

let instance: CompanyService | undefined;

export function getCompanyService(): CompanyService {
  instance ??= new CompanyService(
    new PrismaCompanyRepository(),
    new PrismaActivityLogRepository()
  );
  return instance;
}
