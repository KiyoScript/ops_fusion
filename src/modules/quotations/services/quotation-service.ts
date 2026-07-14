import { format } from "date-fns";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { type Actor } from "@/lib/authz";
import { assertCan, type AppAction } from "@/lib/ability";
import {
  JobOrderStatus,
  QuotationStatus,
  QuotationType,
  type TaxType,
} from "@/generated/prisma/enums";
import type { ICustomerRepository } from "@/modules/shared/repositories/customer-repository";
import type { IActivityLogRepository } from "@/modules/shared/repositories/activity-log-repository";
import type { DbTx } from "@/modules/shared/repositories/types";
import type { Prisma } from "@/generated/prisma/client";
import type { IJobOrderRepository } from "@/modules/job-orders/repositories/job-order-repository";
import { allocateJoNumber } from "@/modules/job-orders/services/job-order-service";
import { sendMail, staffNotifyAddress } from "@/lib/mailer";
import type { IInquiryRepository } from "../repositories/inquiry-repository";
import type {
  IQuotationRepository,
  ItemCreateData,
  QuotationDetailRecord,
  QuotationItemRecord,
  QuotationListRecord,
  StatusSetData,
} from "../repositories/quotation-repository";
import type {
  QuotationCreateInput,
  QuotationDetailDto,
  QuotationItemDto,
  QuotationItemInput,
  QuotationListFilters,
  QuotationListPageDto,
  QuotationListRowDto,
  QuotationTransitionInput,
  QuotationUpdateInput,
} from "../schemas/quotation";
import { computeTotals, type Totals } from "./totals";

const parseDate = (value?: string): Date | null =>
  value ? new Date(`${value}T00:00:00`) : null;
const toIso = (d: Date | null): string | null => (d ? d.toISOString() : null);
// Date-only fields serialize as LOCAL yyyy-MM-dd (same as the JO module).
const dateOnly = (d: Date | null): string | null =>
  d ? format(d, "yyyy-MM-dd") : null;
const money = (n: number): string => n.toFixed(2);

// A quote is editable until it leaves the drafting loop. Editing a REJECTED
// quote resets it to DRAFT (fix-and-resubmit, clearing the old verdict).
const EDITABLE_STATUSES: QuotationStatus[] = [
  QuotationStatus.DRAFT,
  QuotationStatus.PENDING_APPROVAL,
  QuotationStatus.REJECTED,
];

// Lifecycle: DRAFT → PENDING_APPROVAL → APPROVED/REJECTED → SENT → CONVERTED
// (conversion happens in convertToJobOrder, not via transition()).
const TRANSITIONS: Record<
  QuotationTransitionInput["action"],
  { from: QuotationStatus[]; to: QuotationStatus; ability: AppAction }
> = {
  submit: {
    from: [QuotationStatus.DRAFT],
    to: QuotationStatus.PENDING_APPROVAL,
    ability: "update",
  },
  approve: {
    from: [QuotationStatus.PENDING_APPROVAL],
    to: QuotationStatus.APPROVED,
    ability: "approve",
  },
  reject: {
    from: [QuotationStatus.PENDING_APPROVAL],
    to: QuotationStatus.REJECTED,
    ability: "approve",
  },
  send: {
    from: [QuotationStatus.APPROVED],
    to: QuotationStatus.SENT,
    ability: "send",
  },
};

export class QuotationService {
  constructor(
    private readonly quotations: IQuotationRepository,
    private readonly customers: ICustomerRepository,
    private readonly activity: IActivityLogRepository,
    private readonly jobOrders: IJobOrderRepository,
    private readonly inquiries: IInquiryRepository
  ) {}

  /** One yearly series PER TYPE — replaces the 27 per-product prefixes of
   *  the legacy system, but keeps the JO-style discriminator prefix so a
   *  glance at the number tells the flavor apart:
   *    SALES → Q-  ·  PO → PO-  ·  NON_JO → NJ-  */
  private async generateQuoteNumber(
    type: QuotationType,
    tx: DbTx
  ): Promise<string> {
    const prefix =
      type === QuotationType.PO ? "PO" : type === QuotationType.NON_JO ? "NJ" : "Q";
    const year = format(new Date(), "yyyy");
    const seq = await this.quotations.nextCounter(
      `quotation:${prefix}:${year}`,
      tx
    );
    return `${prefix}-${year}-${String(seq).padStart(4, "0")}`;
  }

  async list(
    _actor: Actor,
    filters: QuotationListFilters
  ): Promise<QuotationListPageDto> {
    const { rows, nextCursor } = await this.quotations.listPage(filters);
    return { rows: rows.map(mapListRow), nextCursor };
  }

  async get(_actor: Actor, id: string): Promise<QuotationDetailDto> {
    const detail = await this.quotations.findDetail(id);
    if (!detail) throw new NotFoundError("Quotation not found.");
    return mapDetail(detail);
  }

  async create(
    actor: Actor,
    input: QuotationCreateInput
  ): Promise<{ id: string; quoteNumber: string }> {
    assertCan(actor, "create", "Quotation");

    const totals = totalsOf(input);
    const items = buildItems(input.items, totals);

    // Validate the inquiry link up front so a stale prefill fails cleanly.
    if (input.inquiryId) {
      const inquiry = await this.inquiries.findById(input.inquiryId);
      if (!inquiry) throw new NotFoundError("Inquiry not found.");
      if (inquiry.quotationId) {
        throw new ConflictError(
          `Inquiry already has quotation ${inquiry.quotation?.quoteNumber ?? ""}.`
        );
      }
    }

    return this.quotations.withTransaction(async (tx) => {
      const customer = await this.customers.findOrCreateByName(
        input.customerName,
        actor.id,
        tx
      );
      const type = input.type as QuotationType;
      const created = await this.quotations.createWithItems(
        {
          quoteNumber: await this.generateQuoteNumber(type, tx),
          type,
          poNumber: type === QuotationType.PO ? input.poNumber?.trim() || null : null,
          customerId: customer.id,
          status: QuotationStatus.DRAFT,
          validUntil: parseDate(input.validUntil),
          subtotal: money(totals.subtotal),
          discount: money(totals.discount),
          taxType: input.taxType,
          taxAmount: money(totals.taxAmount),
          total: money(totals.total),
          paymentTermLabel: input.paymentTermLabel || null,
          downpaymentRate: input.downpaymentRate,
          notes: input.notes || null,
          createdById: actor.id,
          items,
        },
        tx
      );
      if (input.inquiryId) {
        await this.inquiries.linkQuotation(
          input.inquiryId,
          created.id,
          customer.id,
          tx
        );
      }
      await this.activity.log(
        {
          userId: actor.id,
          entityType: "Quotation",
          entityId: created.id,
          action: "create",
          payload: {
            quoteNumber: created.quoteNumber,
            items: items.length,
            total: money(totals.total),
            ...(input.inquiryId ? { inquiryId: input.inquiryId } : {}),
          },
        },
        tx
      );
      return created;
    });
  }

  async update(actor: Actor, input: QuotationUpdateInput): Promise<void> {
    assertCan(actor, "update", "Quotation");

    const detail = await this.quotations.findDetail(input.id);
    if (!detail) throw new NotFoundError("Quotation not found.");
    if (!EDITABLE_STATUSES.includes(detail.status)) {
      throw new ValidationError(
        `A ${statusLabel(detail.status)} quotation can no longer be edited.`
      );
    }

    const totals = totalsOf(input);
    const built = buildItems(input.items, totals);

    const existingIds = new Set(detail.items.map((i) => i.id));
    const keptIds = new Set(
      input.items.map((i) => i.id).filter((id): id is string => !!id)
    );
    const deleteIds = [...existingIds].filter((id) => !keptIds.has(id));
    const toUpdate: { id: string; data: ItemCreateData }[] = [];
    const toCreate: ItemCreateData[] = [];
    input.items.forEach((item, index) => {
      if (item.id && existingIds.has(item.id)) {
        toUpdate.push({ id: item.id, data: built[index]! });
      } else {
        toCreate.push(built[index]!);
      }
    });

    await this.quotations.withTransaction(async (tx) => {
      const customer = await this.customers.findOrCreateByName(
        input.customerName,
        actor.id,
        tx
      );
      const updType = input.type as QuotationType;
      await this.quotations.updateHeader(
        input.id,
        {
          type: updType,
          poNumber:
            updType === QuotationType.PO ? input.poNumber?.trim() || null : null,
          customerId: customer.id,
          validUntil: parseDate(input.validUntil),
          subtotal: money(totals.subtotal),
          discount: money(totals.discount),
          taxType: input.taxType,
          taxAmount: money(totals.taxAmount),
          total: money(totals.total),
          paymentTermLabel: input.paymentTermLabel || null,
          downpaymentRate: input.downpaymentRate,
          notes: input.notes || null,
        },
        tx
      );
      await this.quotations.replaceItems(
        input.id,
        { create: toCreate, update: toUpdate, deleteIds },
        tx
      );
      // Fix-and-resubmit: editing a rejected quote returns it to DRAFT and
      // clears the stale verdict so the next submit starts clean.
      if (detail.status === QuotationStatus.REJECTED) {
        await this.quotations.setStatus(
          input.id,
          {
            status: QuotationStatus.DRAFT,
            approvedById: null,
            approvedAt: null,
            rejectedReason: null,
          },
          tx
        );
      }
      await this.activity.log(
        {
          userId: actor.id,
          entityType: "Quotation",
          entityId: input.id,
          action: "update",
          payload: {
            quoteNumber: detail.quoteNumber,
            created: toCreate.length,
            updated: toUpdate.length,
            deleted: deleteIds.length,
            total: money(totals.total),
          },
        },
        tx
      );
    });
  }

  /** Lifecycle steps (submit / approve / reject / send) — one method so the
   *  from-status rules and audit trail live in a single place. */
  async transition(actor: Actor, input: QuotationTransitionInput): Promise<void> {
    const rule = TRANSITIONS[input.action];
    assertCan(actor, rule.ability, "Quotation");

    const detail = await this.quotations.findDetail(input.id);
    if (!detail) throw new NotFoundError("Quotation not found.");
    if (!rule.from.includes(detail.status)) {
      throw new ValidationError(
        `Cannot ${input.action} a ${statusLabel(detail.status)} quotation.`
      );
    }

    const data: StatusSetData = { status: rule.to };
    if (input.action === "approve") {
      data.approvedById = actor.id;
      data.approvedAt = new Date();
      data.rejectedReason = null;
    } else if (input.action === "reject") {
      data.rejectedReason = input.reason!.trim();
    } else if (input.action === "send") {
      data.sentAt = new Date();
    }

    await this.quotations.withTransaction(async (tx) => {
      await this.quotations.setStatus(input.id, data, tx);
      await this.activity.log(
        {
          userId: actor.id,
          entityType: "Quotation",
          entityId: input.id,
          action: `status-${input.action}`,
          payload: {
            quoteNumber: detail.quoteNumber,
            from: detail.status,
            to: rule.to,
            ...(input.reason ? { reason: input.reason } : {}),
          },
        },
        tx
      );
    });

    // Approval heads-up for the supervisors' inbox (legacy notifyQuoteSaved_
    // parity). Best-effort AFTER commit — mail must never fail the save.
    if (input.action === "submit") {
      const to = staffNotifyAddress();
      if (to) {
        await sendMail({
          to,
          subject: `Quotation ${detail.quoteNumber} awaits approval`,
          text: [
            `${detail.quoteNumber} for ${detail.customer.name} was submitted for approval.`,
            `Total: PHP ${detail.total.toString()}`,
            ``,
            `Review it on the Quotations page.`,
          ].join("\n"),
        });
      }
    }
  }

  /** The point of the fusion: an approved (or sent) quotation becomes a
   *  DRAFT Job Order — pre-production, so the JO customer-approval gate and
   *  review flow still apply before work starts. Replaces the legacy
   *  "copy Job Order text to clipboard" hand-off. */
  async convertToJobOrder(
    actor: Actor,
    id: string
  ): Promise<{ jobOrderId: string; joNumber: string }> {
    assertCan(actor, "convert", "Quotation");

    const detail = await this.quotations.findDetail(id);
    if (!detail) throw new NotFoundError("Quotation not found.");
    if (detail.jobOrder) {
      throw new ConflictError(
        `Already converted to JO ${detail.jobOrder.joNumber}.`
      );
    }
    if (
      detail.status !== QuotationStatus.APPROVED &&
      detail.status !== QuotationStatus.SENT
    ) {
      throw new ValidationError(
        "Only an approved or sent quotation can be converted to a JO."
      );
    }

    return this.quotations.withTransaction(async (tx) => {
      const joNumber = await allocateJoNumber(this.jobOrders, tx);
      const created = await this.jobOrders.createWithItems(
        {
          joNumber,
          quotationId: detail.id,
          customerId: detail.customer.id,
          status: JobOrderStatus.DRAFT,
          isLFP: false,
          subtotal: detail.subtotal.toString(),
          total: detail.total.toString(),
          notes: conversionNotes(detail),
          createdById: actor.id,
          items: detail.items.map((item, index) => ({
            description: item.description,
            qty: item.qty,
            unitPrice: item.unitPrice.toString(),
            lineTotal: item.lineTotal.toString(),
            specs: (item.specs ?? undefined) as
              | Prisma.InputJsonValue
              | undefined,
            lineItemId: `${joNumber}-${String(index + 1).padStart(2, "0")}`,
            sortOrder: index,
          })),
        },
        tx
      );
      await this.jobOrders.addJoStatusHistory(
        {
          jobOrderId: created.id,
          fromStatus: null,
          toStatus: JobOrderStatus.DRAFT,
          changedById: actor.id,
          remarks: `converted from ${detail.quoteNumber}`,
        },
        tx
      );
      await this.quotations.setStatus(
        id,
        { status: QuotationStatus.CONVERTED },
        tx
      );
      await this.activity.log(
        {
          userId: actor.id,
          entityType: "Quotation",
          entityId: id,
          action: "convert",
          payload: { quoteNumber: detail.quoteNumber, joNumber },
        },
        tx
      );
      return { jobOrderId: created.id, joNumber };
    });
  }

  /** Soft removal — converted quotes are history and stay. */
  async archive(actor: Actor, id: string): Promise<void> {
    assertCan(actor, "archive", "Quotation");
    const detail = await this.quotations.findDetail(id);
    if (!detail) throw new NotFoundError("Quotation not found.");
    if (detail.status === QuotationStatus.CONVERTED) {
      throw new ValidationError(
        "This quotation was converted to a JO and cannot be archived."
      );
    }

    await this.quotations.withTransaction(async (tx) => {
      await this.quotations.softDelete(id, tx);
      await this.activity.log(
        {
          userId: actor.id,
          entityType: "Quotation",
          entityId: id,
          action: "archive",
          payload: { quoteNumber: detail.quoteNumber },
        },
        tx
      );
    });
  }
}

// ——— input → persistence payloads ———

function totalsOf(input: QuotationCreateInput): Totals {
  return computeTotals({
    items: input.items.map((item) => ({
      qty: parseInt(item.qty, 10),
      unitPrice: parseFloat(item.unitPrice),
      discount: parseFloat(item.discount || "0"),
    })),
    discount: parseFloat(input.discount || "0"),
    taxType: input.taxType,
    downpaymentRate: parseFloat(input.downpaymentRate),
  });
}

function buildItems(
  items: QuotationItemInput[],
  totals: Totals
): ItemCreateData[] {
  return items.map((item, index) => ({
    productId: item.productId || null,
    description: item.description,
    qty: parseInt(item.qty, 10),
    unitPrice: money(parseFloat(item.unitPrice)),
    discount: money(parseFloat(item.discount || "0")),
    lineTotal: money(totals.lineTotals[index]!),
    specs: item.specs as Prisma.InputJsonValue | undefined,
    sortOrder: index,
  }));
}

/** JO notes carry the commercial context the JO schema has no columns for. */
function conversionNotes(detail: QuotationDetailRecord): string {
  const context = [`Converted from ${detail.quoteNumber}`];
  if (detail.paymentTermLabel) context.push(detail.paymentTermLabel);
  if (detail.taxType !== "NON_VAT") {
    context.push(
      detail.taxType === "VAT_EXCLUSIVE" ? "VAT Exclusive" : "VAT Inclusive"
    );
  }
  return [context.join(" · "), detail.notes].filter(Boolean).join("\n");
}

// ——— record → DTO mapping (Decimal/Date never leave the server raw) ———

function statusLabel(status: QuotationStatus): string {
  return status.toLowerCase().replace(/_/g, " ");
}

/** A quote past its valid-until date that never reached a terminal state. */
function isExpired(record: {
  validUntil: Date | null;
  status: QuotationStatus;
}): boolean {
  if (!record.validUntil) return false;
  if (
    record.status === QuotationStatus.CONVERTED ||
    record.status === QuotationStatus.REJECTED ||
    record.status === QuotationStatus.EXPIRED
  ) {
    return record.status === QuotationStatus.EXPIRED;
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return record.validUntil.getTime() < today.getTime();
}

function mapListRow(row: QuotationListRecord): QuotationListRowDto {
  return {
    id: row.id,
    quoteNumber: row.quoteNumber,
    type: row.type,
    poNumber: row.poNumber,
    customerName: row.customer.name,
    status: row.status,
    total: row.total.toString(),
    itemCount: row._count.items,
    validUntil: dateOnly(row.validUntil),
    isExpired: isExpired(row),
    createdAt: row.createdAt.toISOString(),
    createdByName: row.createdBy.name,
  };
}

function mapItem(item: QuotationItemRecord): QuotationItemDto {
  return {
    id: item.id,
    productId: item.productId,
    description: item.description,
    qty: item.qty,
    unitPrice: item.unitPrice.toString(),
    discount: item.discount.toString(),
    lineTotal: item.lineTotal.toString(),
    specs: (item.specs as Record<string, unknown> | null) ?? null,
  };
}

function mapDetail(detail: QuotationDetailRecord): QuotationDetailDto {
  const rate = parseFloat(detail.downpaymentRate.toString());
  const total = parseFloat(detail.total.toString());
  const downpayment = Math.round(total * rate * 100) / 100;
  return {
    id: detail.id,
    quoteNumber: detail.quoteNumber,
    type: detail.type,
    poNumber: detail.poNumber,
    status: detail.status,
    customer: detail.customer,
    validUntil: dateOnly(detail.validUntil),
    isExpired: isExpired(detail),
    notes: detail.notes,
    totals: {
      subtotal: detail.subtotal.toString(),
      discount: detail.discount.toString(),
      taxType: detail.taxType,
      taxAmount: detail.taxAmount.toString(),
      total: detail.total.toString(),
      paymentTermLabel: detail.paymentTermLabel,
      downpaymentRate: detail.downpaymentRate.toString(),
      downpayment: downpayment.toFixed(2),
      balance: (total - downpayment).toFixed(2),
    },
    sentAt: toIso(detail.sentAt),
    approvedAt: toIso(detail.approvedAt),
    approvedByName: detail.approvedBy?.name ?? null,
    rejectedReason: detail.rejectedReason,
    convertedJoId: detail.jobOrder?.id ?? null,
    convertedJoNumber: detail.jobOrder?.joNumber ?? null,
    createdAt: detail.createdAt.toISOString(),
    createdByName: detail.createdBy.name,
    items: detail.items.map(mapItem),
  };
}

export type { TaxType };
