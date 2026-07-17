import { assertCan } from "@/lib/ability";
import type { Actor } from "@/lib/authz";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { BookletStatus, BookletType } from "@/generated/prisma/enums";
import type { IActivityLogRepository } from "@/modules/shared/repositories/activity-log-repository";
import { PrismaActivityLogRepository } from "@/modules/shared/repositories/activity-log-repository";
import type {
  BookletRecord,
  IBookletRepository,
} from "../repositories/booklet-repository";
import { PrismaBookletRepository } from "../repositories/booklet-repository";
import {
  BOOKLET_PREFIX,
  BOOKLET_TYPE_LABEL,
  type BookletDto,
  type BookletListFilters,
  type BookletSuggestionDto,
  type CreateBookletInput,
  type RejectBookletInput,
} from "../schemas/booklet";

/** Legacy DocSeriesService booklets were blocks of 50 — now only a suggestion. */
const DEFAULT_BOOKLET_SIZE = 50;

/** Format a booklet number the way it's pre-printed on the leaf: IN-0578. */
export function formatDocumentNo(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(4, "0")}`;
}

export class BookletService {
  constructor(
    private readonly booklets: IBookletRepository,
    private readonly activity: IActivityLogRepository
  ) {}

  async list(actor: Actor, filters: BookletListFilters): Promise<BookletDto[]> {
    assertCan(actor, "read", "Booklet");
    const records = await this.booklets.list(filters);
    return records.map(toDto);
  }

  /**
   * What the "register a booklet" form pre-fills: the block straight after the
   * last range of that type. The admin can overwrite both ends — booklet size
   * is not fixed (a 25-, 50- or 100-leaf booklet all work).
   */
  async suggestRange(
    actor: Actor,
    type: BookletType
  ): Promise<BookletSuggestionDto> {
    assertCan(actor, "read", "Booklet");
    const maxEnd = await this.booklets.maxSeriesEnd(type);
    return {
      type,
      prefix: BOOKLET_PREFIX[type],
      suggestedStart: maxEnd + 1,
      suggestedEnd: maxEnd + DEFAULT_BOOKLET_SIZE,
    };
  }

  /** Cashier registers a booklet → lands as PENDING_APPROVAL for an admin. */
  async create(actor: Actor, input: CreateBookletInput): Promise<{ id: string }> {
    assertCan(actor, "create", "Booklet");

    if (input.seriesEnd < input.seriesStart) {
      throw new ValidationError("Series end must not be lower than series start.");
    }

    const created = await this.booklets.create({
      type: input.type,
      prefix: BOOKLET_PREFIX[input.type],
      label: input.label?.trim() || null,
      seriesStart: input.seriesStart,
      seriesEnd: input.seriesEnd,
      nextNumber: input.seriesStart,
      gapExempt: input.gapExempt,
      openedById: actor.id,
    });

    await this.activity.log({
      userId: actor.id,
      entityType: "Booklet",
      entityId: created.id,
      action: "create",
      payload: {
        type: input.type,
        range: `${input.seriesStart}-${input.seriesEnd}`,
      },
    });
    return created;
  }

  /**
   * Admin approves a booklet into service. Only one booklet per type may be
   * ACTIVE — the database enforces it too (partial unique index), so a race
   * surfaces as a conflict rather than two live booklets.
   */
  async approve(actor: Actor, id: string): Promise<void> {
    assertCan(actor, "approve", "Booklet");
    const booklet = await this.mustFind(id);

    if (
      booklet.status !== BookletStatus.PENDING_APPROVAL &&
      booklet.status !== BookletStatus.UNOPENED &&
      booklet.status !== BookletStatus.REJECTED
    ) {
      throw new ValidationError(
        `A booklet that is ${booklet.status.toLowerCase()} can't be activated.`
      );
    }

    try {
      await this.booklets.setStatus(id, {
        status: BookletStatus.ACTIVE,
        approvedById: actor.id,
        approvedAt: new Date(),
        rejectionNote: null,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictError(
          `Another ${BOOKLET_TYPE_LABEL[booklet.type]} booklet is already active. Close it before activating this one.`
        );
      }
      throw err;
    }

    await this.activity.log({
      userId: actor.id,
      entityType: "Booklet",
      entityId: id,
      action: "approve",
      payload: { type: booklet.type },
    });
  }

  async reject(actor: Actor, input: RejectBookletInput): Promise<void> {
    assertCan(actor, "approve", "Booklet");
    const booklet = await this.mustFind(input.id);
    if (booklet.status !== BookletStatus.PENDING_APPROVAL) {
      throw new ValidationError("Only a requested booklet can be rejected.");
    }
    await this.booklets.setStatus(input.id, {
      status: BookletStatus.REJECTED,
      rejectionNote: input.note?.trim() || null,
    });
    await this.activity.log({
      userId: actor.id,
      entityType: "Booklet",
      entityId: input.id,
      action: "reject",
      payload: { note: input.note ?? "" },
    });
  }

  /** Cashier re-submits a rejected booklet (legacy reRequestDocSeries). */
  async reRequest(actor: Actor, id: string): Promise<void> {
    assertCan(actor, "create", "Booklet");
    const booklet = await this.mustFind(id);
    if (booklet.status !== BookletStatus.REJECTED) {
      throw new ValidationError("Only a rejected booklet can be re-submitted.");
    }
    await this.booklets.setStatus(id, {
      status: BookletStatus.PENDING_APPROVAL,
      rejectionNote: null,
    });
    await this.activity.log({
      userId: actor.id,
      entityType: "Booklet",
      entityId: id,
      action: "re-request",
      payload: {},
    });
  }

  /** Close a booklet early — leaves spoiled, or a booklet retired by hand. */
  async close(actor: Actor, id: string): Promise<void> {
    assertCan(actor, "approve", "Booklet");
    const booklet = await this.mustFind(id);
    if (booklet.status !== BookletStatus.ACTIVE) {
      throw new ValidationError("Only an active booklet can be closed.");
    }
    await this.booklets.setStatus(id, { status: BookletStatus.CLOSED });
    await this.activity.log({
      userId: actor.id,
      entityType: "Booklet",
      entityId: id,
      action: "close",
      payload: { unusedLeaves: booklet.seriesEnd - booklet.nextNumber + 1 },
    });
  }

  /** A booklet that has issued even one receipt is a permanent record. */
  async delete(actor: Actor, id: string): Promise<void> {
    assertCan(actor, "approve", "Booklet");
    await this.mustFind(id);
    if (await this.booklets.hasIssuedDocuments(id)) {
      throw new ValidationError(
        "This booklet has already issued receipts — it can't be deleted. Close it instead."
      );
    }
    await this.booklets.delete(id);
    await this.activity.log({
      userId: actor.id,
      entityType: "Booklet",
      entityId: id,
      action: "delete",
      payload: {},
    });
  }

  private async mustFind(id: string): Promise<BookletRecord> {
    const booklet = await this.booklets.findById(id);
    if (!booklet) throw new NotFoundError("Booklet not found.");
    return booklet;
  }
}

// ——— record → DTO ———

function toDto(b: BookletRecord): BookletDto {
  const capacity = b.seriesEnd - b.seriesStart + 1;
  const used = Math.min(b.nextNumber - b.seriesStart, capacity);
  const remaining = capacity - used;
  return {
    id: b.id,
    type: b.type,
    typeLabel: BOOKLET_TYPE_LABEL[b.type],
    prefix: b.prefix,
    label: b.label,
    seriesStart: b.seriesStart,
    seriesEnd: b.seriesEnd,
    nextNumber: b.nextNumber,
    status: b.status,
    gapExempt: b.gapExempt,
    rejectionNote: b.rejectionNote,
    capacity,
    used,
    remaining,
    nextDocumentNo:
      b.status === BookletStatus.ACTIVE && remaining > 0
        ? formatDocumentNo(b.prefix, b.nextNumber)
        : null,
    openedByName: b.openedBy.name,
    approvedByName: b.approvedBy?.name ?? null,
    createdAt: b.createdAt.toISOString(),
  };
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2002"
  );
}

let instance: BookletService | undefined;

export function getBookletService(): BookletService {
  instance ??= new BookletService(
    new PrismaBookletRepository(),
    new PrismaActivityLogRepository()
  );
  return instance;
}
