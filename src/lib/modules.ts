// ═══════════════════════════════════════════════════════════════════════════
// Module registry — the single source of truth for which feature modules the
// app has (Flipper-style feature flags). Pure data, safe on client + server.
//
// The DB (ModuleFlag) stores only OVERRIDES; a module with no row falls back
// to `defaultEnabled` here. Adding a module = one entry here (+ a toggle in
// Settings). Dashboard and Settings are intentionally NOT modules — they are
// always available (Settings houses the switches themselves).
// ═══════════════════════════════════════════════════════════════════════════

export const MODULE_KEYS = [
  "inquiries",
  "quotations",
  "sales-audit",
  "receivables",
  "credit-control",
  "job-orders",
  "delivery-receipts",
  "inventory",
  "customers",
  "products",
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

export type ModuleDef = {
  key: ModuleKey;
  label: string;
  description: string;
  /** Grouping for the Settings toggles UI. */
  group: "Sales" | "Operations" | "Masters";
  /** State used when there is no DB override yet. */
  defaultEnabled: boolean;
  /** Every route this module owns — used to block navigation when disabled.
   *  A path matches a prefix when it equals it or starts with `prefix + "/"`. */
  routes: string[];
};

export const MODULES: ModuleDef[] = [
  {
    key: "inquiries",
    label: "Inquiries",
    description: "The pre-quote inquiry log (walk-in / call / portal).",
    group: "Sales",
    defaultEnabled: true,
    routes: ["/inquiries"],
  },
  {
    key: "quotations",
    label: "Quotations",
    description:
      "Quote builder, supervisor approval, convert to Job Order, plus its price/workflow maintenance.",
    group: "Sales",
    defaultEnabled: true,
    routes: ["/quotations", "/maintenance/quotations"],
  },
  {
    key: "sales-audit",
    label: "Sales & Audit",
    description:
      "Receipts (SI / JO slip), collections, booklets, and daily reconciliation.",
    group: "Sales",
    defaultEnabled: true,
    routes: ["/sales-audit", "/maintenance/sales-audit"],
  },
  {
    key: "receivables",
    label: "Accounts Receivable",
    description:
      "Open charge invoices by customer, aging, collections, and statements of account.",
    group: "Sales",
    defaultEnabled: true,
    // More specific than sales-audit's "/sales-audit" — moduleForPath resolves
    // by LONGEST matching prefix, so this wins for its own subtree.
    routes: ["/sales-audit/receivables"],
  },
  {
    key: "credit-control",
    label: "Credit Terms & Limits",
    description:
      "Per-customer payment terms and a credit ceiling that blocks new charge invoices once exceeded.",
    group: "Sales",
    // OFF by default, on purpose. docs/sales.txt sets no terms and no ceiling,
    // so this is added behaviour rather than a legacy rule (AGENTS.md: never
    // invent rules). Switched off, charge invoices behave exactly as before —
    // always allowed, never falling due.
    defaultEnabled: false,
    // A pure behaviour flag: it owns no pages, it changes what the Receive
    // Payment gate and the customer form allow.
    routes: [],
  },
  {
    key: "job-orders",
    label: "Job Orders",
    description:
      "Per-item production board, calendar, reports, archive, and JO maintenance.",
    group: "Operations",
    defaultEnabled: true,
    routes: ["/job-orders", "/maintenance/job-orders"],
  },
  {
    key: "delivery-receipts",
    label: "Delivery Receipts",
    description: "Issue and track DRs against completed JO items.",
    group: "Operations",
    defaultEnabled: true,
    routes: ["/delivery-receipts"],
  },
  {
    key: "inventory",
    label: "Inventory & Materials",
    description:
      "Item master, ledger-derived stock, adjustments, cycle counts, reorder alerts, and its supplier maintenance.",
    group: "Operations",
    defaultEnabled: true,
    routes: ["/inventory", "/maintenance/inventory"],
  },
  {
    key: "customers",
    label: "Customers",
    description: "The shared customer master.",
    group: "Masters",
    defaultEnabled: true,
    routes: ["/customers", "/maintenance/customers"],
  },
  {
    key: "products",
    label: "Products",
    description: "The product catalog and parametric price rules.",
    group: "Masters",
    defaultEnabled: true,
    routes: ["/products"],
  },
];

const pathMatchesPrefix = (pathname: string, prefix: string): boolean =>
  pathname === prefix || pathname.startsWith(prefix + "/");

/** The module that owns a route, or null when the route is always available
 *  (Dashboard, Settings, auth, …). Used by the route guard.
 *
 *  Resolved by LONGEST matching prefix, not by declaration order: modules can
 *  nest ("/sales-audit" owns the module, "/sales-audit/receivables" owns a
 *  subtree of it), and the more specific owner has to win regardless of where
 *  it sits in MODULES. First-match would silently hand the child's routes to
 *  the parent and leave the child's switch doing nothing. */
export function moduleForPath(pathname: string): ModuleKey | null {
  let best: ModuleKey | null = null;
  let bestLength = -1;
  for (const m of MODULES) {
    for (const route of m.routes) {
      if (route.length > bestLength && pathMatchesPrefix(pathname, route)) {
        best = m.key;
        bestLength = route.length;
      }
    }
  }
  return best;
}

/** Merge coded defaults with DB overrides into the set of enabled keys. */
export function resolveEnabledModules(
  overrides: ReadonlyMap<string, boolean>
): Set<ModuleKey> {
  const enabled = new Set<ModuleKey>();
  for (const m of MODULES) {
    const on = overrides.has(m.key) ? overrides.get(m.key)! : m.defaultEnabled;
    if (on) enabled.add(m.key);
  }
  return enabled;
}
