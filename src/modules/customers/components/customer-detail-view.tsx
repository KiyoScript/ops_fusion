"use client";

import { useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { PencilIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AttachmentsCard } from "./attachments-card";
import type { CustomerDetailDto } from "../schemas/customer";
import { VAT_STATUS_LABEL } from "../vat";
import { CustomerStatusBadge, VatBadge } from "./badges";

const peso = (v: string | null) => {
  if (v === null) return "—";
  const n = parseFloat(v);
  return isNaN(n) ? v : `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
};
const d = (s: string) => format(new Date(s), "M/d/yyyy h:mma");
const pretty = (s: string) => s.replace(/_/g, " ").toLowerCase();

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm wrap-break-word">{value || "—"}</span>
    </div>
  );
}
function Empty({ what }: { what: string }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">No {what}{" "}in range.</p>;
}
function Num({ children }: { children: React.ReactNode }) {
  return <span className="font-mono font-medium">{children}</span>;
}
function DocLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="font-mono font-medium underline underline-offset-2 hover:text-primary">{children}</Link>;
}
function Summary({ text, count }: { text: string; count: number }) {
  return text ? (
    <span className="text-sm wrap-break-word">{text}</span>
  ) : (
    <span className="text-sm text-muted-foreground">{count} item{count === 1 ? "" : "s"}</span>
  );
}
function Pill({ children }: { children: React.ReactNode }) {
  return <Badge variant="outline" className="font-normal">{children}</Badge>;
}
function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="grid gap-0.5 text-center">
      <span className="text-lg font-semibold tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}
function MetricCard({ label, value, hint, href }: { label: string; value: string; hint?: string; href?: string }) {
  const body = (
    <>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-lg font-semibold wrap-break-word">{value}</span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </>
  );
  return href ? (
    <Link href={href} className="grid content-start gap-0.5 rounded-lg border p-3 transition-colors hover:bg-accent/40">{body}</Link>
  ) : (
    <div className="grid content-start gap-0.5 rounded-lg border p-3">{body}</div>
  );
}
function TabCount({ label, n }: { label: string; n: number }) {
  return (
    <span className="flex items-center gap-1.5">
      {label}
      {n > 0 && <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">{n}</span>}
    </span>
  );
}
function DocTable<T extends { id: string }>({
  head, rows, empty, render,
}: {
  head: string[];
  rows: T[];
  empty: string;
  render: (row: T) => React.ReactNode;
}) {
  if (rows.length === 0) return <Empty what={empty} />;
  return (
    <Card className="py-0">
      <CardContent className="overflow-x-auto px-0">
        <Table>
          <TableHeader>
            <TableRow>{head.map((h) => <TableHead key={h}>{h}</TableHead>)}</TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => <TableRow key={r.id}>{render(r)}</TableRow>)}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export function CustomerDetailView({
  customer: c,
  canEdit,
}: {
  customer: CustomerDetailDto;
  canEdit: boolean;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [query, setQuery] = useState("");
  const inRange = (iso: string) => {
    const t = new Date(iso).getTime();
    if (from && t < new Date(from).getTime()) return false;
    if (to && t > new Date(`${to}T23:59:59`).getTime()) return false;
    return true;
  };
  const q = query.trim().toLowerCase();
  const hit = (...parts: (string | null | undefined)[]) =>
    !q || parts.some((p) => (p ?? "").toLowerCase().includes(q));
  const quotations = c.quotations.filter((x) => inRange(x.createdAt) && hit(x.number, x.status, x.summary));
  const jobOrders = c.jobOrders.filter((x) => inRange(x.createdAt) && hit(x.number, x.status, x.summary));
  const deliveries = c.deliveries.filter((x) => inRange(x.issuedAt) && hit(x.number, x.status, x.summary));
  const sales = c.sales.filter((x) => inRange(x.saleDate) && hit(x.documentNo, x.paymentStatus));
  const collections = c.collections.filter((x) => inRange(x.receivedAt) && hit(x.number));
  const advancePayments = c.advancePayments.filter((x) => inRange(x.receivedAt) && hit(x.status));
  const isContact = c.companyId !== null;

  // Overview metrics (client-side, from the loaded history).
  const money = (n: number) => `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
  const totalQuoted = c.quotations.reduce((s, x) => s + (parseFloat(x.total) || 0), 0);
  const totalJo = c.jobOrders.reduce((s, x) => s + (parseFloat(x.total) || 0), 0);
  const totalCollected = c.collections.reduce((s, x) => s + (parseFloat(x.amount) || 0), 0);
  const activityDates = [
    ...c.quotations.map((x) => x.createdAt), ...c.jobOrders.map((x) => x.createdAt),
    ...c.deliveries.map((x) => x.issuedAt), ...c.sales.map((x) => x.saleDate),
    ...c.collections.map((x) => x.receivedAt), ...c.advancePayments.map((x) => x.receivedAt),
  ];
  const lastActivity = activityDates.length
    ? new Date(Math.max(...activityDates.map((s) => new Date(s).getTime())))
    : null;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <CustomerStatusBadge status={c.status} />
        {c.vatStatus && <VatBadge status={c.vatStatus} />}
        {isContact && (
          <Link href={`/customers/companies/${c.companyId}`} className="text-sm font-medium underline">
            {c.company ? `${c.company} (company)` : "View company"}
          </Link>
        )}
        {canEdit && (
          <Button
            variant="outline"
            className="ml-auto"
            nativeButton={false}
            render={<Link href={`/customers/${c.id}/edit`} />}
          >
            <PencilIcon /> Edit
          </Button>
        )}
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="quotations"><TabCount label="Quotations" n={c.counts.quotations} /></TabsTrigger>
          <TabsTrigger value="jobOrders"><TabCount label="Job Orders" n={c.counts.jobOrders} /></TabsTrigger>
          <TabsTrigger value="deliveries"><TabCount label="Deliveries" n={c.counts.deliveryReceipts} /></TabsTrigger>
          <TabsTrigger value="sales"><TabCount label="Sales" n={c.counts.sales} /></TabsTrigger>
          <TabsTrigger value="payments"><TabCount label="Payments" n={c.counts.collectionReceipts + c.counts.advancePayments} /></TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="grid gap-4 pt-2">
          <div className="grid grid-cols-3 gap-2 rounded-lg border p-3 sm:grid-cols-4 lg:grid-cols-7">
            <Stat label="Quotations" value={c.counts.quotations} />
            <Stat label="Job orders" value={c.counts.jobOrders} />
            <Stat label="Deliveries" value={c.counts.deliveryReceipts} />
            <Stat label="Sales" value={c.counts.sales} />
            <Stat label="Collections" value={c.counts.collectionReceipts} />
            <Stat label="Adv. pay" value={c.counts.advancePayments} />
            <Stat label="Inquiries" value={c.counts.inquiries} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="Total quoted" value={money(totalQuoted)} hint={`${c.quotations.length} recent`} />
            <MetricCard label="Job order value" value={money(totalJo)} hint={`${c.jobOrders.length} recent`} />
            <MetricCard label="Collected" value={money(totalCollected)} hint={`${c.collections.length} receipt${c.collections.length === 1 ? "" : "s"}`} />
            <MetricCard
              label="Credit standing"
              value={c.creditTermDays ? `${c.creditTermDays}-day terms` : "No terms"}
              hint={c.creditLimit ? `Limit ${money(parseFloat(c.creditLimit))}` : "No limit"}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <MetricCard label="Tax status" value={c.vatStatus ? VAT_STATUS_LABEL[c.vatStatus] : "—"} hint={c.tin ? `TIN ${c.tin}` : "No TIN"} />
            <MetricCard label="Last activity" value={lastActivity ? format(lastActivity, "MMM d, yyyy") : "None"} hint={lastActivity ? format(lastActivity, "h:mm a") : ""} />
            <MetricCard
              label={isContact ? "Company" : "Type"}
              value={isContact ? (c.company ?? "Company contact") : "Individual customer"}
              hint={isContact ? "View company profile →" : undefined}
              href={isContact ? `/customers/companies/${c.companyId}` : undefined}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Added by {c.createdByName} · {format(new Date(c.createdAt), "MMM d, yyyy · h:mm a")}
          </p>
        </TabsContent>

        <TabsContent value="profile" className="grid gap-4 pt-2">
          <Card>
            <CardContent className="grid grid-cols-2 gap-3 pt-6 sm:grid-cols-3">
              <Field label="Contact number" value={c.contactNumber} />
              <Field label="Email" value={c.email} />
              <Field
                label="Company"
                value={isContact ? (
                  <Link href={`/customers/companies/${c.companyId}`} className="underline">{c.company}</Link>
                ) : c.company}
              />
              {isContact && <Field label="Department" value={c.department} />}
              {isContact && <Field label="Position" value={c.position} />}
              <Field label="TIN" value={c.tin} />
              <Field label="Tax status" value={c.vatStatus ? VAT_STATUS_LABEL[c.vatStatus] : "—"} />
              <Field label="Credit terms" value={c.creditTermDays ? `${c.creditTermDays} days` : "No terms"} />
              <Field label="Credit limit" value={peso(c.creditLimit)} />
              <div className="col-span-2 sm:col-span-3"><Field label="Billing address" value={c.address} /></div>
              <div className="col-span-2 sm:col-span-3"><Field label="Shipping address" value={c.shippingAddress} /></div>
            </CardContent>
          </Card>

          {isContact ? (
            <p className="rounded-lg border border-border/60 bg-muted/30 p-3 text-sm text-muted-foreground">
              Billing documents (Credit Request, BIR 2303) are kept on the{" "}
              <Link href={`/customers/companies/${c.companyId}`} className="font-medium text-foreground underline">company profile</Link>.
            </p>
          ) : (
            <AttachmentsCard attachments={c.attachments} target={{ customerId: c.id }} canEdit={canEdit} />
          )}

          {c.notes && <p className="rounded-lg bg-muted/50 p-3 text-sm whitespace-pre-line">{c.notes}</p>}
        </TabsContent>

        {/* Activity tabs share a custom date-range filter. */}
        <div className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
          <div className="grid min-w-52 flex-1 gap-1">
            <Label htmlFor="cd-search" className="text-xs">Search activity</Label>
            <Input id="cd-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Document #, status, or item…" className="h-9" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="cd-from" className="text-xs">From</Label>
            <Input id="cd-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="cd-to" className="text-xs">To</Label>
            <Input id="cd-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-40" />
          </div>
          {(from || to || query) && (
            <Button variant="ghost" size="sm" onClick={() => { setFrom(""); setTo(""); setQuery(""); }}>Clear</Button>
          )}
        </div>

        <TabsContent value="quotations" className="pt-2">
          <DocTable head={["Quote #", "For", "Status", "Total", "Date"]} rows={quotations} empty="quotations"
            render={(q) => (
              <>
                <TableCell><DocLink href={`/quotations/${q.id}`}>{q.number}</DocLink></TableCell>
                <TableCell className="max-w-md"><Summary text={q.summary} count={q.itemCount} /></TableCell>
                <TableCell><Pill>{pretty(q.status)}</Pill></TableCell>
                <TableCell className="tabular-nums">{peso(q.total)}</TableCell>
                <TableCell className="text-muted-foreground whitespace-nowrap">{d(q.createdAt)}</TableCell>
              </>
            )} />
        </TabsContent>

        <TabsContent value="jobOrders" className="pt-2">
          <DocTable head={["JO #", "For", "Status", "Total", "Date"]} rows={jobOrders} empty="job orders"
            render={(j) => (
              <>
                <TableCell><DocLink href={`/job-orders/${j.id}`}>{j.number}</DocLink></TableCell>
                <TableCell className="max-w-md"><Summary text={j.summary} count={j.itemCount} /></TableCell>
                <TableCell><Pill>{pretty(j.status)}</Pill></TableCell>
                <TableCell className="tabular-nums">{peso(j.total)}</TableCell>
                <TableCell className="text-muted-foreground whitespace-nowrap">{d(j.createdAt)}</TableCell>
              </>
            )} />
        </TabsContent>

        <TabsContent value="deliveries" className="pt-2">
          <DocTable head={["DR #", "For", "Status", "Issued"]} rows={deliveries} empty="delivery receipts"
            render={(x) => (
              <>
                <TableCell><Num>{x.number}</Num></TableCell>
                <TableCell className="max-w-md"><Summary text={x.summary} count={x.itemCount} /></TableCell>
                <TableCell><Pill>{pretty(x.status)}</Pill></TableCell>
                <TableCell className="text-muted-foreground whitespace-nowrap">{d(x.issuedAt)}</TableCell>
              </>
            )} />
        </TabsContent>

        <TabsContent value="sales" className="pt-2">
          <DocTable head={["Receipt #", "Payment", "Amount", "Date"]} rows={sales} empty="sales"
            render={(s) => (
              <>
                <TableCell><Num>{s.documentNo}</Num></TableCell>
                <TableCell><Pill>{pretty(s.paymentStatus)}</Pill></TableCell>
                <TableCell className="tabular-nums">{peso(s.amount)}</TableCell>
                <TableCell className="text-muted-foreground">{d(s.saleDate)}</TableCell>
              </>
            )} />
        </TabsContent>

        <TabsContent value="payments" className="grid gap-4 pt-2">
          <div>
            <h3 className="mb-1.5 text-sm font-semibold">Collection receipts</h3>
            <DocTable head={["CR #", "Amount", "Date"]} rows={collections} empty="collection receipts"
              render={(cr) => (
                <>
                  <TableCell><Num>{cr.number ?? "— (no doc)"}</Num></TableCell>
                  <TableCell className="tabular-nums">{peso(cr.amount)}</TableCell>
                  <TableCell className="text-muted-foreground">{d(cr.receivedAt)}</TableCell>
                </>
              )} />
          </div>
          <div>
            <h3 className="mb-1.5 text-sm font-semibold">Advance payments</h3>
            <DocTable head={["Amount", "Status", "Date"]} rows={advancePayments} empty="advance payments"
              render={(ap) => (
                <>
                  <TableCell className="tabular-nums">{peso(ap.amount)}</TableCell>
                  <TableCell><Pill>{pretty(ap.status)}</Pill></TableCell>
                  <TableCell className="text-muted-foreground">{d(ap.receivedAt)}</TableCell>
                </>
              )} />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
