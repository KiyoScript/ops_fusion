import Link from "next/link";
import { ArrowUpRightIcon, TriangleAlertIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { Actor } from "@/lib/authz";
import { getEnabledModuleKeys } from "@/modules/shared/services/module-flag-service";
import { getReceivableService } from "../services";
import {
  AGING_BUCKETS,
  AGING_BUCKET_LABEL,
  type AgingBucket,
} from "../schemas/receipt";

// ══════════════════════════════════════════════════════════════════════════
// A/R AT A GLANCE — the finance track's slice of the customer profile.
//
// This lives in sales-audit, not in the customers module, for two reasons.
// The obvious one is branch discipline: the customer directory belongs to the
// core-dev track, and dropping two hundred lines of receivables logic into it
// guarantees merge pain. The better one is that there should be exactly ONE
// definition of what a customer owes. ReceivableService already owns it —
// open balance, aging, credit held, over-limit — so this component reads that
// definition rather than recomputing it beside it, where the two would
// eventually disagree and nobody would know which was right.
//
// The customer page therefore gains one import and one line of JSX.
// ══════════════════════════════════════════════════════════════════════════

const peso = (v: string) =>
  `₱${Number(v).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const isZero = (v: string) => Math.round(Number(v) * 100) === 0;

/** Aging colours run cool → hot. Current is unremarkable; 90+ is a problem. */
const BUCKET_TONE: Record<AgingBucket, string> = {
  CURRENT: "text-foreground",
  D1_30: "text-foreground",
  D31_60: "text-amber-600 dark:text-amber-500",
  D61_90: "text-orange-600 dark:text-orange-500",
  D90_PLUS: "text-red-600 dark:text-red-500",
};

function Figure({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: string;
  hint?: string;
}) {
  return (
    <div className="grid content-start gap-0.5 rounded-lg border p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("text-lg font-semibold tabular-nums", tone)}>{value}</span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

export async function CustomerArPanel({
  actor,
  customerId,
}: {
  actor: Actor;
  customerId: string;
}) {
  // The whole A/R feature is switchable (src/lib/modules.ts). With it off the
  // shop runs exactly as it did before receivables existed, so this renders
  // nothing rather than an empty shell.
  const enabled = await getEnabledModuleKeys();
  if (!enabled.has("receivables")) return null;

  const account = await getReceivableService().account(actor, customerId);

  const owesNothing = isZero(account.totalOutstanding);
  const holdsNoCredit = isZero(account.creditOnAccount);

  // A customer with no debt and no credit on file has no account to show.
  // Rendering "₱0.00" five times says nothing and pushes the real content down.
  if (owesNothing && holdsNoCredit) return null;

  // Read, never recomputed. ReceivableService owns the over-limit verdict —
  // including the company roll-up that makes a contact's ceiling company-wide —
  // so the profile and the A/R ledger cannot disagree about the same customer.
  const limit = account.creditLimit;
  const available = account.creditAvailable;
  const overLimit = account.overLimit;
  // A contact's ceiling is measured against their whole company's A/R, so
  // "over limit" on someone who personally owes very little needs explaining.
  const sharedCeiling =
    account.companyId !== null &&
    Math.round(Number(account.exposure) * 100) !==
      Math.round(Number(account.totalOutstanding) * 100);

  const worstBucket = [...AGING_BUCKETS]
    .reverse()
    .find((b) => !isZero(account.aging[b]));
  const seriouslyOverdue =
    worstBucket === "D61_90" || worstBucket === "D90_PLUS";

  return (
    <Card className={cn(overLimit && "border-red-500/50")}>
      <CardContent className="grid gap-3 pt-6">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">Accounts receivable</h3>
          {overLimit && (
            <Badge variant="destructive" className="gap-1 font-normal">
              <TriangleAlertIcon className="size-3" /> Over credit limit
            </Badge>
          )}
          {seriouslyOverdue && !overLimit && (
            <Badge variant="outline" className="gap-1 border-red-500/50 font-normal text-red-600 dark:text-red-500">
              <TriangleAlertIcon className="size-3" />
              {AGING_BUCKET_LABEL[worstBucket!]} overdue
            </Badge>
          )}
          {account.creditControlEnabled && account.creditTermDays !== null && (
            <Badge variant="outline" className="font-normal">
              Net {account.creditTermDays} days
            </Badge>
          )}
          {sharedCeiling && account.companyName && (
            <Badge variant="outline" className="font-normal">
              Limit shared with {account.companyName}
            </Badge>
          )}
          <Link
            href={`/sales-audit/receivables/${customerId}`}
            className="ml-auto flex items-center gap-1 text-sm font-medium underline underline-offset-2 hover:text-primary"
          >
            Full account &amp; statement <ArrowUpRightIcon className="size-3.5" />
          </Link>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Figure
            label="Outstanding"
            value={peso(account.totalOutstanding)}
            tone={owesNothing ? undefined : "text-red-600 dark:text-red-500"}
            hint={`${account.invoices.length} open invoice${account.invoices.length === 1 ? "" : "s"}`}
          />
          <Figure
            label="Credit on account"
            value={peso(account.creditOnAccount)}
            tone={holdsNoCredit ? undefined : "text-emerald-600 dark:text-emerald-500"}
            hint={
              holdsNoCredit
                ? "none held"
                : "held for them — not netted off what they owe"
            }
          />
          {account.creditControlEnabled ? (
            <>
              <Figure
                label="Credit limit"
                value={limit === null ? "No limit" : peso(limit)}
                hint={limit === null ? "no ceiling agreed" : undefined}
              />
              <Figure
                label="Available"
                value={available === null ? "—" : peso(available)}
                tone={overLimit ? "text-red-600 dark:text-red-500" : undefined}
                hint={
                  sharedCeiling
                    ? `after ${peso(account.exposure)} company-wide`
                    : overLimit
                      ? "ceiling exceeded"
                      : undefined
                }
              />
            </>
          ) : (
            <Figure
              label="Oldest overdue"
              value={
                worstBucket && worstBucket !== "CURRENT"
                  ? AGING_BUCKET_LABEL[worstBucket]
                  : "None"
              }
              hint="credit control is off"
            />
          )}
        </div>

        {!owesNothing && (
          <div className="grid grid-cols-2 gap-2 rounded-lg border p-3 sm:grid-cols-5">
            {AGING_BUCKETS.map((b) => (
              <div key={b} className="grid gap-0.5 text-center">
                <span
                  className={cn(
                    "text-sm font-semibold tabular-nums",
                    isZero(account.aging[b])
                      ? "text-muted-foreground"
                      : BUCKET_TONE[b]
                  )}
                >
                  {peso(account.aging[b])}
                </span>
                <span className="text-xs text-muted-foreground">
                  {AGING_BUCKET_LABEL[b]}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
