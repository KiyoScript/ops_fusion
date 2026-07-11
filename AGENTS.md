<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# OPS Fusion — what this project is (read me first)

OPS Fusion is the ERP for **Ormoc Printshoppe**, consolidating **six legacy
Google Apps Script + Sheets systems** into one app (one login, one PostgreSQL
database) built around the **Job Order**. Main flow:
Customer → Estimate → Job Order → Production → Costing → Delivery → Billing → Collection.

## Legacy systems being fused (source of truth for behavior)

| Legacy system | Local repo (sibling of this one) | Becomes | Status |
|---|---|---|---|
| JOWebApp | `BeMore/JOWebApp` | Job Orders module | In progress (core dev) |
| Paper DR booklet | — (physical BIR form) | Delivery Receipts module | In progress (core dev) |
| SignQuote / quotation_system | `BeMore/quotation_system` | Quotations module | **Collaborator branch** |
| Sales-Audit | `BeMore/Sales-Audit` | Sales & Audit module | **Collaborator branch** |
| **PRISM 2.0** | `BeMore/PRISM---Audit` | LFP Production module (roll/substrate inventory, plotting, print queue, LFP audit) | Planned — **after Sales-Audit** |
| **MACWebApp** | `MACWebApp` | Inventory & Materials, then Purchasing (PR → PO → Receiving) | Planned — after PRISM |
| **AssignedTask** | `BeMore/AssignedTask` | JO Task Assignment (per-day employee tasks + Code/PIN portal) | Planned — **after Inventory**; design doc done |

PRISM connection: legacy JOWebApp syncs LFP job orders into PRISM's `JobOrders`
inbox sheet; in Fusion this becomes an internal link — `JobOrderItem.isLFP`
items feed the LFP Production module.

## Non-negotiable rules

- **Legacy behavior 1:1** — "nothing less, nothing more." Reverse-engineer the
  running legacy system before rebuilding; never invent rules.
- **Document → then build** — each module gets a Blueprint-format design
  (schema/ERD/workflows/roles) approved before code. The Master System
  Blueprint (Google Drive) is the source of truth; ClickUp tracks tasks.
- **Definition of done** = a green end-to-end verify script
  (`scripts/verify-<module>.ts`, run with `npx tsx`) driving real services
  against a real database — plus clean `tsc --noEmit` and ESLint.
- **Branch discipline** — Quotations & Sales-Audit belong to the collaborator
  branch. Core-dev work must not touch those modules (`src/modules/quotations`,
  `src/modules/sales-audit`) or their schema files, to avoid merge conflicts.
- **Data discipline** — qty = `Int`; money = `Decimal(12,2)` (never Float);
  **never truncate** descriptions/specs in any view; soft deletes
  (`deletedAt`); one `ActivityLog` row per mutation.
- **Where things live** — Prisma schema is folder-based: `prisma/schema/`
  (one file per domain; enums live beside their owning model). Permissions:
  `src/lib/ability/policies/` (one CASL policy file per resource, registered
  in `policies/index.ts`). Modules: `src/modules/<module>/{components,services,repositories,schemas,hooks}`
  — repositories hold ALL Prisma calls; services hold logic + `assertCan`.
