# Modules — architecture conventions

This app is a **modular monolith**. Every module follows the same strict layering:

```
modules/<module>/
  components/     # Module-specific UI (React). Renders only — no business logic.
  services/       # Business logic (classes). Depend on repository INTERFACES,
                  # injected via constructor. Never import Prisma directly.
                  # Authorization checks live HERE, not just in the UI.
  repositories/   # ALL Prisma queries for the module. Implement the interfaces
                  # consumed by services. No business rules here.
  schemas/        # Zod schemas + z.infer types. Defined ONCE per entity, reused
                  # for Server Action validation, form validation, and types.
  hooks/          # TanStack Query hooks (client-side server-state).
```

Modules: `shared` (customers, products, booklets, users), `quotations`,
`job-orders`, `sales-audit`, `delivery-receipts`.

## Mutation convention (documented decision)

**Server Actions** are the convention for all mutations (files named
`actions.ts`, colocated with the route or in the module). Route Handlers are
used only where Server Actions don't fit (file exports, CSV import endpoints,
webhooks). Every action:

1. Validates input with the module's Zod schema **before** calling a service.
2. Calls a service method (which enforces authorization + business rules).
3. Returns the shared `ActionResult<T>` envelope from `@/lib/errors` — never a
   raw Prisma model and never a thrown error.

## Non-negotiables (from the project brief)

- No `any`. No `Float` for money (Prisma `Decimal`, formatted at the edge).
- No Prisma calls inside loops — batch with `findMany`/`in`, `include`, or
  `groupBy`/`aggregate`.
- Cursor-based pagination on all list endpoints.
- `prisma.$transaction` for every multi-step write.
- Soft deletes (`deletedAt`) for business records; hard deletes are forbidden.
- Every mutation on a core entity writes an `ActivityLog` row.
- Domain state machines (JO status, quotation lifecycle) live in domain
  classes under `services/`, not scattered in components.
