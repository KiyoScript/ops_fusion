import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import type { Actor } from "@/lib/authz";
import { assertCan } from "@/lib/ability";
import type { IActivityLogRepository } from "@/modules/shared/repositories/activity-log-repository";
import { PrismaActivityLogRepository } from "@/modules/shared/repositories/activity-log-repository";
import type {
  ISupplierRepository,
  SupplierRecord,
} from "../repositories/supplier-repository";
import { PrismaSupplierRepository } from "../repositories/supplier-repository";
import type {
  SupplierDto,
  SupplierInput,
  SupplierListFilters,
} from "../schemas/material";

export class SupplierService {
  constructor(
    private readonly suppliers: ISupplierRepository,
    private readonly activity: IActivityLogRepository
  ) {}

  async list(
    _actor: Actor,
    filters: SupplierListFilters
  ): Promise<SupplierDto[]> {
    const rows = await this.suppliers.list(filters);
    return rows.map(mapSupplier);
  }

  async get(_actor: Actor, id: string): Promise<SupplierDto> {
    const s = await this.suppliers.findById(id);
    if (!s) throw new NotFoundError("Supplier not found.");
    return mapSupplier(s);
  }

  async create(actor: Actor, input: SupplierInput): Promise<{ id: string }> {
    assertCan(actor, "maintain", "Supplier");
    const code = input.code?.trim();
    if (code && (await this.suppliers.codeExists(code))) {
      throw new ConflictError(`Supplier code "${code}" already exists.`);
    }
    const created = await this.suppliers.create(input, actor.id);
    await this.activity.log({
      userId: actor.id,
      entityType: "Supplier",
      entityId: created.id,
      action: "create",
      payload: { name: input.name },
    });
    return created;
  }

  async update(
    actor: Actor,
    id: string,
    input: SupplierInput
  ): Promise<void> {
    assertCan(actor, "maintain", "Supplier");
    const existing = await this.suppliers.findById(id);
    if (!existing) throw new NotFoundError("Supplier not found.");
    const code = input.code?.trim();
    if (code && (await this.suppliers.codeExists(code, id))) {
      throw new ConflictError(`Supplier code "${code}" already exists.`);
    }
    await this.suppliers.update(id, input);
    await this.activity.log({
      userId: actor.id,
      entityType: "Supplier",
      entityId: id,
      action: "update",
      payload: { name: input.name },
    });
  }

  async archive(actor: Actor, id: string): Promise<void> {
    assertCan(actor, "maintain", "Supplier");
    const existing = await this.suppliers.findById(id);
    if (!existing) throw new NotFoundError("Supplier not found.");
    if (await this.suppliers.hasActiveMaterials(id)) {
      throw new ValidationError(
        "This supplier is still linked to active items. Reassign or archive those items first."
      );
    }
    await this.suppliers.softDelete(id);
    await this.activity.log({
      userId: actor.id,
      entityType: "Supplier",
      entityId: id,
      action: "archive",
      payload: {},
    });
  }
}

function mapSupplier(s: SupplierRecord): SupplierDto {
  return {
    id: s.id,
    code: s.code,
    name: s.name,
    contactPerson: s.contactPerson,
    phone: s.phone,
    email: s.email,
    address: s.address,
    notes: s.notes,
    status: s.status,
    materialCount: s._count.materials,
    createdAt: s.createdAt.toISOString(),
  };
}

let instance: SupplierService | undefined;

export function getSupplierService(): SupplierService {
  instance ??= new SupplierService(
    new PrismaSupplierRepository(),
    new PrismaActivityLogRepository()
  );
  return instance;
}
