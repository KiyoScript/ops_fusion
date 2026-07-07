# Ops Enterprise System

A unified operations platform for the print business (Ormoc Printshoppe / BeMore), built with [Next.js](https://nextjs.org). It consolidates three existing Google Apps Script + Google Sheets systems into one application covering the full business lifecycle: **Quotation → Job Order → Sales → Delivery → Audit**.

> **Status:** Early development. Functional spec is at v0.1 draft (JO → Sales → DR System). Scope and data model are still being finalized.

## Background — the three legacy systems

This project unifies and replaces the following systems (all Google Apps Script + Google Sheets, in sibling repos under `BeMore/`):

| Legacy System | What it does | Becomes |
| --- | --- | --- |
| `quotation_system` (SignQuote) | Quotation generator for ~27 product types, price database, public customer quote portal | Quote/QJOS integration feeding the JO Module |
| `JOWebApp` (Job Order System 2026) | Job order tracking: JO CRUD, deadline calendar, EOD reports, incident reports, PRISM production sync | JO Module |
| `Sales-Audit` | Cashier sales logging (SI/JO/CR), auditor reconciliation, day locking, BIR VAT tagging, doc series tracking | Sales Module (incl. Audit & Bank Recon) |

Today these run as separate apps with three different auth schemes and duplicated customer/employee data. This system replaces them with one platform, one database, and one role-based access model.

## Planned Modules

- **JO Module** — Job Order lifecycle: inquiry → quote (supervisor-approved) → customer confirmation + payment gate → approval → printing (dot-matrix, continuous form) → production sub-workflows → completion.
- **Sales Module** — Booklets (Sales Invoice VAT/Non-VAT, JO Order Slip, Collection Receipt), customer-classification-driven payment handling, non-JO transactions (photocopy, printing, laminate, supplies), CR-to-invoice settlement, reports, sales audit workflow, bank reconciliation.
- **DR Module** — Delivery Receipt lifecycle: booklet maintenance with approval, per-line-item issuance with partial quantities, advance payment application, reports.
- **Shared masters** — Customer & Customer Classification, Advance Payments, Booklet numbering (sequential series + approval-on-opening), roles & permissions.

## Tech Stack

- [Next.js](https://nextjs.org) 16.2.10 (App Router)
- [React](https://react.dev) 19
- [TypeScript](https://www.typescriptlang.org) 5
- [Tailwind CSS](https://tailwindcss.com) 4
- [ESLint](https://eslint.org) 9

## System Requirements

Before running this project, make sure you have the following installed:

| Requirement | Version                | Notes                                              |
| ----------- | ---------------------- | -------------------------------------------------- |
| Node.js     | `>= 20.9.0` (LTS)      | Required by Next.js 16 — [download](https://nodejs.org) |
| npm         | `>= 10`                | Comes bundled with Node.js (project uses `package-lock.json`) |
| Git         | Latest                 | [download](https://git-scm.com/downloads)          |

**OS:** Windows, macOS, or Linux are all supported.

To verify your installed versions:

```bash
node -v
npm -v
git --version
```

## Getting Started

### 1. Clone the repository

```bash
git clone <repository-url>
cd ops_enterprise_system
```

### 2. Install dependencies

```bash
npm install
```

### 3. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Available Scripts

| Command         | Description                              |
| --------------- | ---------------------------------------- |
| `npm run dev`   | Start the development server             |
| `npm run build` | Create a production build                |
| `npm run start` | Start the production server (after build) |
| `npm run lint`  | Run ESLint checks                        |

## Development Notes

- **Legacy business rules live in the legacy repos.** Before building a feature, check the corresponding implementation in `JOWebApp`, `quotation_system`, or `Sales-Audit` for statuses, roles, numbering schemes, BIR fields, and workflows.
- **Next.js version caveat:** this project pins a Next.js version whose APIs and conventions may differ from older docs — read the guides bundled in `node_modules/next/dist/docs/` before writing framework-facing code (see `AGENTS.md`).
- **Printing:** JOs print on dot-matrix printers with continuous 2-ply forms, which requires a raw/character-based print path rather than standard browser/PDF printing. Treat this as a technical spike.
