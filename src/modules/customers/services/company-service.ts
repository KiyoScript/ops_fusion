import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { type Actor } from "@/lib/authz";
import { assertCan, can } from "@/lib/ability";
import type { AttachmentKind, VatStatus } from "@/generated/prisma/enums";
import type { IActivityLogRepository } from "@/modules/shared/repositories/activity-log-repository";
import { PrismaActivityLogRepository } from "@/modules/shared/repositories/activity-log-repository";
import {
  PrismaCompanyRepository,
  type CompanyBilling,
  type CompanyDetailRecord,
  type CompanyListRecord,
} from "../repositories/company-repository";
import { composePersonName } from "../person-name";
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

    // Same split as update(): creating a customer is an encoder's job, but
    // agreeing credit terms with them is not (docs/sales-contract.md R8). A new
    // customer created by an encoder simply starts with no terms and no
    // ceiling — which is the pre-existing behaviour anyway, since both fields
    // are nullable and null means "no terms agreed".
    const maySetCredit = can(actor, "maintain", "Maintenance");

    if (input.kind === "INDIVIDUAL") {
      const { id } = await this.repo.createIndividual(
        {
          lastName: input.lastName,
          firstName: input.firstName,
          middleInitial: input.middleInitial ?? null,
          contactNumber: input.contactNumber,
          email: input.email ?? null,
          company: input.company ?? null,
          address: input.address ?? null,
          shippingAddress: input.shippingAddress ?? null,
          tin: input.tin ?? null,
          vatStatus: input.vatStatus ?? null,
          creditTermDays: maySetCredit ? input.creditTermDays ?? null : null,
          notes: input.notes ?? null,
        },
        actor.id
      );
      await this.activity.log({
        userId: actor.id, entityType: "Customer", entityId: id,
        action: "create",
        payload: { name: composePersonName(input), kind: "individual" },
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
          lastName: input.contact.lastName,
          firstName: input.contact.firstName,
          middleInitial: input.contact.middleInitial ?? null,
          department: input.contact.department,
          position: input.contact.position,
          email: input.contact.email,
          contactNumber: input.contact.contactNumber,
        },
        actor.id
      );
      await this.activity.log({
        userId: actor.id, entityType: "Company", entityId: input.companyId,
        action: "add-contact", payload: { contact: composePersonName(input.contact) },
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
      creditTermDays: maySetCredit ? co.creditTermDays ?? null : null,
      creditLimit:
        maySetCredit && co.creditLimit !== undefined
          ? co.creditLimit.toFixed(2)
          : null,
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
          lastName: input.contact.lastName,
          firstName: input.contact.firstName,
          middleInitial: input.contact.middleInitial ?? null,
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
      action: "create", payload: { name: co.name, firstContact: composePersonName(input.contact) },
    });
    return result;
  }

  // Company rows carry TIN, VAT standing, credit terms and ceilings — the
  // billing file for the entity, so every read is gated (R9).
  async list(
    actor: Actor,
    q: string | undefined,
    cursor: string | undefined,
    take: number,
    vatStatus?: VatStatus
  ): Promise<{ rows: CompanyListRowDto[]; nextCursor: string | null }> {
    assertCan(actor, "read", "Customer");
    const { rows, nextCursor } = await this.repo.listPage(q, cursor, take, vatStatus);
    return { rows: rows.map(mapListRow), nextCursor };
  }

  async getDetail(actor: Actor, id: string): Promise<CompanyDetailDto> {
    assertCan(actor, "read", "Customer");
    const c = await this.repo.findDetail(id);
    if (!c) throw new NotFoundError("Company not found.");
    return mapDetail(c);
  }

  async search(actor: Actor, q: string): Promise<CompanySearchDto[]> {
    assertCan(actor, "read", "Customer");
    if (!q.trim()) return [];
    return this.repo.search(q.trim());
  }

  /** Company picker for the add-customer flow (carries billing to auto-fill). */
  async searchForAdd(actor: Actor, q: string): Promise<CompanyPickerDto[]> {
    assertCan(actor, "read", "Customer");
    if (!q.trim()) return [];
    return this.repo.searchForPicker(q.trim());
  }

  /** One company in picker shape — pre-scopes the add-contact form. */
  async getPicker(actor: Actor, id: string): Promise<CompanyPickerDto | null> {
    assertCan(actor, "read", "Customer");
    return this.repo.findPickerById(id);
  }

  async update(actor: Actor, input: CompanyUpdateInput): Promise<void> {
    assertCan(actor, "update", "Customer");

    // Credit terms and ceilings are admin reference data, not something the
    // cashier editing a company's phone number decides (docs/sales-contract.md
    // R8). This method is gated on `update Customer`, which ENCODER holds, so
    // the credit fields are only honoured when the actor ALSO holds the
    // Maintenance ability that ReceivableService.setCredit requires. Anyone
    // else keeps whatever is already on file — their edit succeeds, the credit
    // policy simply does not move with it.
    const maySetCredit = can(actor, "maintain", "Maintenance");
    const existing = maySetCredit ? null : await this.repo.getBilling(input.id);
    if (!maySetCredit && !existing) throw new NotFoundError("Company not found.");

    const billing: CompanyBilling = {
      name: input.name,
      tin: input.tin,
      vatStatus: input.vatStatus ?? null,
      creditTermDays: maySetCredit
        ? input.creditTermDays ?? null
        : existing!.creditTermDays,
      creditLimit: maySetCredit
        ? input.creditLimit !== undefined
          ? input.creditLimit.toFixed(2)
          : null
        : existing!.creditLimit,
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
