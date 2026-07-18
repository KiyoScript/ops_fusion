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
  "job-orders",
  "delivery-receipts",
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
    key: "customers",
    label: "Customers",
    description: "The shared customer master.",
    group: "Masters",
    defaultEnabled: true,
    routes: ["/customers"],
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
 *  (Dashboard, Settings, auth, …). Used by the route guard. */
export function moduleForPath(pathname: string): ModuleKey | null {
  for (const m of MODULES) {
    if (m.routes.some((r) => pathMatchesPrefix(pathname, r))) return m.key;
  }
  return null;
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
