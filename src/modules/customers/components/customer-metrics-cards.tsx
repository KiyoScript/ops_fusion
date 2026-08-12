import Link from "next/link";
import { cn } from "@/lib/utils";
import type { CustomerMetricsDto } from "../schemas/customer";

// Left-accent color per metric — clicking a card filters the directory.
const COLOR: Record<string, string> = {
  blue: "border-l-blue-400 hover:bg-blue-50 dark:hover:bg-blue-500/10",
  slate: "border-l-slate-400 hover:bg-slate-50 dark:hover:bg-slate-500/10",
  emerald: "border-l-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10",
  amber: "border-l-amber-400 hover:bg-amber-50 dark:hover:bg-amber-500/10",
  rose: "border-l-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10",
  violet: "border-l-violet-400 hover:bg-violet-50 dark:hover:bg-violet-500/10",
};

/** At-a-glance directory metrics for quick decisions (tax mix, credit exposure,
 *  company vs individual split). Each card links into the filtered directory. */
export function CustomerMetricsCards({ m }: { m: CustomerMetricsDto }) {
  const cards: { label: string; value: number; hint?: string; href: string; color: keyof typeof COLOR }[] = [
    { label: "Companies", value: m.companies, hint: `${m.contacts} contact${m.contacts === 1 ? "" : "s"}`, href: "/customers?tab=companies", color: "blue" },
    { label: "Individuals", value: m.individuals, hint: `${m.active} active · ${m.inactive} inactive`, href: "/customers?tab=individuals", color: "slate" },
    { label: "VAT", value: m.vat, hint: "VAT-registered", href: "/customers?tab=individuals&vat=VAT", color: "emerald" },
    { label: "Non-VAT", value: m.nonVat, hint: "non-VAT", href: "/customers?tab=individuals&vat=NON_VAT", color: "amber" },
    { label: "No TIN", value: m.noTin, hint: "unregistered", href: "/customers?tab=individuals&vat=NO_TIN", color: "rose" },
    { label: "On credit terms", value: m.withTerms, hint: "have net terms", href: "/customers?tab=individuals", color: "violet" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {cards.map((c) => (
        <Link
          key={c.label}
          href={c.href}
          className={cn(
            "grid content-start gap-0.5 rounded-lg border border-l-4 p-3 transition-colors",
            COLOR[c.color]
          )}
        >
          <span className="text-2xl font-semibold tabular-nums">{c.value}</span>
          <span className="text-xs font-medium">{c.label}</span>
          {c.hint && <span className="text-xs text-muted-foreground wrap-break-word">{c.hint}</span>}
        </Link>
      ))}
    </div>
  );
}
