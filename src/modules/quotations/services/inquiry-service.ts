import { NotFoundError, ValidationError } from "@/lib/errors";
import { type Actor } from "@/lib/authz";
import { assertCan } from "@/lib/ability";
import type { Prisma } from "@/generated/prisma/client";
import type { InquiryMedium } from "@/generated/prisma/enums";
import type { IActivityLogRepository } from "@/modules/shared/repositories/activity-log-repository";
import type { ICustomerRepository } from "@/modules/shared/repositories/customer-repository";
import type {
  IInquiryRepository,
  InquiryRecord,
} from "../repositories/inquiry-repository";
import type {
  InquiryCloseInput,
  InquiryCreateInput,
  InquiryListFilters,
  InquiryMetricsDto,
  InquiryPageDto,
  InquiryRowDto,
  InquiryUpdateInput,
  PortalRequestInput,
} from "../schemas/inquiry";

export class InquiryService {
  constructor(
    private readonly inquiries: IInquiryRepository,
    private readonly activity: IActivityLogRepository,
    private readonly customers: ICustomerRepository
  ) {}

  /** Resolve the typed name to a customer master record — matching an existing
   *  customer (case-insensitive) or quick-creating a new one — then enrich the
   *  master's contact/email where it's still blank (never overwriting). Returns
   *  the customer's id + canonical name to store on the inquiry. */
  private async resolveCustomer(
    name: string,
    contactNumber: string | null,
    email: string | null,
    creatorId: string
  ): Promise<{ id: string; name: string }> {
    const customer = await this.customers.findOrCreateByName(name, creatorId);
    await this.customers.fillContactDetails(customer.id, {
      contactNumber: contactNumber || undefined,
      email: email || undefined,
    });
    return customer;
  }

  async list(
    _actor: Actor,
    filters: InquiryListFilters
  ): Promise<InquiryPageDto> {
    const { rows, nextCursor } = await this.inquiries.listPage(filters);
    return { rows: rows.map(mapRow), nextCursor };
  }

  /** Log an inquiry FROM the quote form (Option B): stores the full form
   *  snapshot on the inquiry so nothing is lost. It lives in the Inquiries
   *  module — NOT the Quotations list — and the snapshot is restored verbatim
   *  when the inquiry is later converted to a quote. */
  async logDraft(
    actor: Actor,
    input: {
      customerName: string;
      contactNumber: string | null;
      medium: InquiryMedium;
      servicesRequested: string;
      notes: string | null;
      draft: Prisma.InputJsonValue;
    }
  ): Promise<{ id: string }> {
    assertCan(actor, "create", "Inquiry");
    const customer = await this.resolveCustomer(
      input.customerName,
      input.contactNumber,
      null,
      actor.id
    );
    const created = await this.inquiries.create({
      customerId: customer.id,
      customerName: customer.name,
      contactNumber: input.contactNumber,
      email: null,
      medium: input.medium,
      servicesRequested: input.servicesRequested,
      notes: input.notes,
      draft: input.draft,
      createdById: actor.id,
    });
    await this.activity.log({
      userId: actor.id,
      entityType: "Inquiry",
      entityId: created.id,
      action: "create",
      payload: { customerName: input.customerName, medium: input.medium, withDraft: true },
    });
    return created;
  }

  /** The stored quote-form snapshot for an inquiry — restored on convert. */
  async getDraft(_actor: Actor, id: string): Promise<unknown | null> {
    return this.inquiries.findDraft(id);
  }

  /** Update an inquiry that's edited in the FULL quote form — persists the
   *  edited draft snapshot + the simple fields. Email is left untouched (the
   *  quote form doesn't carry it), so it's never wiped. */
  async updateDraft(
    actor: Actor,
    id: string,
    input: {
      customerName: string;
      contactNumber: string | null;
      medium: InquiryMedium;
      servicesRequested: string;
      notes: string | null;
      draft: Prisma.InputJsonValue;
    }
  ): Promise<void> {
    assertCan(actor, "update", "Inquiry");
    const existing = await this.inquiries.findById(id);
    if (!existing) throw new NotFoundError("Inquiry not found.");
    const customer = await this.resolveCustomer(
      input.customerName,
      input.contactNumber,
      null,
      actor.id
    );
    await this.inquiries.update(id, {
      customerId: customer.id,
      customerName: customer.name,
      contactNumber: input.contactNumber,
      medium: input.medium,
      servicesRequested: input.servicesRequested,
      notes: input.notes,
      draft: input.draft,
    });
    await this.activity.log({
      userId: actor.id,
      entityType: "Inquiry",
      entityId: id,
      action: "update",
      payload: { customerName: input.customerName, withDraft: true },
    });
  }

  async get(_actor: Actor, id: string): Promise<InquiryRowDto> {
    const record = await this.inquiries.findById(id);
    if (!record) throw new NotFoundError("Inquiry not found.");
    return mapRow(record);
  }

  async create(actor: Actor, input: InquiryCreateInput): Promise<{ id: string }> {
    assertCan(actor, "create", "Inquiry");
    const customer = await this.resolveCustomer(
      input.customerName,
      input.contactNumber || null,
      input.email || null,
      actor.id
    );
    const created = await this.inquiries.create({
      customerId: customer.id,
      customerName: customer.name,
      contactNumber: input.contactNumber || null,
      email: input.email || null,
      medium: input.medium,
      servicesRequested: input.servicesRequested,
      notes: input.notes || null,
      createdById: actor.id,
    });
    await this.activity.log({
      userId: actor.id,
      entityType: "Inquiry",
      entityId: created.id,
      action: "create",
      payload: { customerName: input.customerName, medium: input.medium },
    });
    return created;
  }

  /** Anonymous portal submissions — the ONLY entry that skips assertCan:
   *  the caller is the public quote-request endpoint, and the record is
   *  owned by the seeded "Customer Portal" system user. */
  async createFromPortal(
    portalUserId: string,
    input: PortalRequestInput
  ): Promise<{ id: string }> {
    const customer = await this.resolveCustomer(
      input.customerName,
      input.contactNumber || null,
      input.email || null,
      portalUserId
    );
    const created = await this.inquiries.create({
      customerId: customer.id,
      customerName: customer.name,
      contactNumber: input.contactNumber || null,
      email: input.email || null,
      medium: "PORTAL",
      servicesRequested: input.servicesRequested,
      notes: input.notes || null,
      createdById: portalUserId,
    });
    await this.activity.log({
      userId: portalUserId,
      entityType: "Inquiry",
      entityId: created.id,
      action: "portal-submit",
      payload: { customerName: input.customerName },
    });
    return created;
  }

  async update(actor: Actor, input: InquiryUpdateInput): Promise<void> {
    assertCan(actor, "update", "Inquiry");
    const record = await this.inquiries.findById(input.id);
    if (!record) throw new NotFoundError("Inquiry not found.");
    const customer = await this.resolveCustomer(
      input.customerName,
      input.contactNumber || null,
      input.email || null,
      actor.id
    );
    await this.inquiries.update(input.id, {
      customerId: customer.id,
      customerName: customer.name,
      contactNumber: input.contactNumber || null,
      email: input.email || null,
      medium: input.medium,
      servicesRequested: input.servicesRequested,
      notes: input.notes || null,
    });
    await this.activity.log({
      userId: actor.id,
      entityType: "Inquiry",
      entityId: input.id,
      action: "update",
      payload: { customerName: input.customerName },
    });
  }

  /** Close an inquiry that never became a quote. A QUOTED inquiry can't be
   *  closed (it already has a quote). */
  async close(actor: Actor, input: InquiryCloseInput): Promise<void> {
    assertCan(actor, "update", "Inquiry");
    const record = await this.inquiries.findById(input.id);
    if (!record) throw new NotFoundError("Inquiry not found.");
    if (record.quotationId) {
      throw new ValidationError("This inquiry already has a quotation.");
    }
    await this.inquiries.close(input.id, input.reason || null);
    await this.activity.log({
      userId: actor.id,
      entityType: "Inquiry",
      entityId: input.id,
      action: "close",
      payload: { reason: input.reason ?? null },
    });
  }

  /** Reopen a closed inquiry. */
  async reopen(actor: Actor, id: string): Promise<void> {
    assertCan(actor, "update", "Inquiry");
    const record = await this.inquiries.findById(id);
    if (!record) throw new NotFoundError("Inquiry not found.");
    await this.inquiries.reopen(id);
    await this.activity.log({
      userId: actor.id,
      entityType: "Inquiry",
      entityId: id,
      action: "reopen",
    });
  }

  async metrics(): Promise<InquiryMetricsDto> {
    return this.inquiries.metrics();
  }
}

function mapRow(record: InquiryRecord): InquiryRowDto {
  return {
    id: record.id,
    customerName: record.customerName,
    contactNumber: record.contactNumber,
    email: record.email,
    medium: record.medium,
    status: record.status,
    closedReason: record.closedReason,
    servicesRequested: record.servicesRequested,
    notes: record.notes,
    quotationId: record.quotationId,
    quoteNumber: record.quotation?.quoteNumber ?? null,
    quoteStatus: record.quotation?.status ?? null,
    createdAt: record.createdAt.toISOString(),
    createdByName: record.createdBy.name,
  };
}
