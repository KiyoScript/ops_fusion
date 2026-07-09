import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { assertRole, type Actor } from "@/lib/authz";
import { Role } from "@/generated/prisma/enums";
import type {
  ILookupRepository,
  LookupRecord,
} from "../repositories/lookup-repository";
import { PrismaLookupRepository } from "../repositories/lookup-repository";
import type {
  IActivityLogRepository,
} from "../repositories/activity-log-repository";
import { PrismaActivityLogRepository } from "../repositories/activity-log-repository";
import type {
  LookupCreateInput,
  LookupDto,
  LookupImportSummaryDto,
  LookupTypeInput,
  LookupUpdateInput,
} from "../schemas/lookup";

// Maintenance lists are configuration: only ADMIN/MANAGER maintain them,
// everyone signed in may read them (they feed pickers).
const MAINTAINER_ROLES = [Role.ADMIN, Role.MANAGER] as const;

export class LookupService {
  constructor(
    private readonly lookups: ILookupRepository,
    private readonly activity: IActivityLogRepository
  ) {}

  async list(
    _actor: Actor,
    type: LookupTypeInput,
    includeInactive = false
  ): Promise<LookupDto[]> {
    const records = await this.lookups.listByType(type, includeInactive);
    return records.map(toDto);
  }

  async create(actor: Actor, input: LookupCreateInput): Promise<LookupDto> {
    assertRole(actor, MAINTAINER_ROLES);
    if (await this.lookups.existsLabel(input.type, input.label)) {
      throw new ConflictError(`"${input.label}" is already on the list.`);
    }
    const created = await this.lookups.create({
      type: input.type,
      label: input.label,
      isLFP: input.isLFP ?? false,
      sortOrder: await this.lookups.nextSortOrder(input.type),
      createdById: actor.id,
    });
    await this.activity.log({
      userId: actor.id,
      entityType: "LookupOption",
      entityId: created.id,
      action: "create",
      payload: { type: input.type, label: input.label },
    });
    return toDto(created);
  }

  async update(actor: Actor, input: LookupUpdateInput): Promise<void> {
    assertRole(actor, MAINTAINER_ROLES);
    const existing = await this.lookups.findById(input.id);
    if (!existing) throw new NotFoundError("Maintenance entry not found.");
    if (
      input.label &&
      (await this.lookups.existsLabel(existing.type, input.label, input.id))
    ) {
      throw new ConflictError(`"${input.label}" is already on the list.`);
    }
    await this.lookups.update(input.id, {
      label: input.label,
      isLFP: input.isLFP,
      isActive: input.isActive,
    });
    await this.activity.log({
      userId: actor.id,
      entityType: "LookupOption",
      entityId: input.id,
      action: "update",
      payload: {
        type: existing.type,
        from: existing.label,
        label: input.label ?? existing.label,
        isActive: input.isActive ?? existing.isActive,
      },
    });
  }

  /** Import the legacy OPSServices sheet (col A = "Sales - <category>",
   *  col B = "LF" marks large-format). The "Sales - " prefix is stripped,
   *  exactly like the legacy cleanCategory rule. Existing labels are skipped. */
  async importCategories(
    actor: Actor,
    rows: string[][]
  ): Promise<LookupImportSummaryDto> {
    assertRole(actor, MAINTAINER_ROLES);

    const summary: LookupImportSummaryDto = {
      created: 0,
      skippedExisting: [],
      errors: [],
    };
    if (rows.length === 0) throw new ValidationError("The file is empty.");

    const seen = new Set<string>();
    const parsed: { label: string; isLFP: boolean; line: number }[] = [];
    rows.forEach((cells, index) => {
      const raw = (cells[0] ?? "").trim();
      if (!raw) return;
      const label = raw.replace(/^sales\s*-\s*/i, "").trim();
      if (!label) return;
      if (seen.has(label.toLowerCase())) {
        summary.errors.push({
          line: index + 1,
          message: `${label}: duplicated in the file`,
        });
        return;
      }
      seen.add(label.toLowerCase());
      parsed.push({
        label,
        isLFP: (cells[1] ?? "").trim().toUpperCase() === "LF",
        line: index + 1,
      });
    });
    if (parsed.length === 0 && summary.errors.length === 0) {
      throw new ValidationError(
        "No category rows found. Upload the OPSServices sheet as .csv or .xlsx."
      );
    }

    const existing = new Set(
      (await this.lookups.listByType("JO_CATEGORY", true)).map((o) =>
        o.label.toLowerCase()
      )
    );
    const toCreate = parsed.filter((p) => {
      if (existing.has(p.label.toLowerCase())) {
        summary.skippedExisting.push(p.label);
        return false;
      }
      return true;
    });

    const startOrder = await this.lookups.nextSortOrder("JO_CATEGORY");
    summary.created = await this.lookups.createMany(
      toCreate.map((p, i) => ({
        type: "JO_CATEGORY" as const,
        label: p.label,
        isLFP: p.isLFP,
        sortOrder: startOrder + i,
        createdById: actor.id,
      }))
    );
    await this.activity.log({
      userId: actor.id,
      entityType: "LookupOption",
      entityId: "opsservices-import",
      action: "import",
      payload: {
        created: summary.created,
        skipped: summary.skippedExisting.length,
        errors: summary.errors.length,
      },
    });
    return summary;
  }

  async remove(actor: Actor, id: string): Promise<void> {
    assertRole(actor, MAINTAINER_ROLES);
    const existing = await this.lookups.findById(id);
    if (!existing) throw new NotFoundError("Maintenance entry not found.");
    // Hard delete is fine: items keep the label as plain text, so history
    // is unaffected — same as deleting a row from the legacy sheet.
    await this.lookups.delete(id);
    await this.activity.log({
      userId: actor.id,
      entityType: "LookupOption",
      entityId: id,
      action: "delete",
      payload: { type: existing.type, label: existing.label },
    });
  }
}

function toDto(record: LookupRecord): LookupDto {
  return {
    id: record.id,
    type: record.type,
    label: record.label,
    isLFP: record.isLFP,
    isActive: record.isActive,
    sortOrder: record.sortOrder,
  };
}

let instance: LookupService | undefined;

export function getLookupService(): LookupService {
  instance ??= new LookupService(
    new PrismaLookupRepository(),
    new PrismaActivityLogRepository()
  );
  return instance;
}
