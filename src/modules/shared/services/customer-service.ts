import type { Actor } from "@/lib/authz";
import type {
  CustomerSuggestion,
  ICustomerRepository,
} from "../repositories/customer-repository";
import { PrismaCustomerRepository } from "../repositories/customer-repository";

export class CustomerService {
  constructor(private readonly customers: ICustomerRepository) {}

  // Any authenticated role may look customers up (needed by pickers).
  async search(_actor: Actor, query: string): Promise<CustomerSuggestion[]> {
    const q = query.trim();
    if (!q) return [];
    return this.customers.search(q);
  }
}

let instance: CustomerService | undefined;

export function getCustomerService(): CustomerService {
  instance ??= new CustomerService(new PrismaCustomerRepository());
  return instance;
}
