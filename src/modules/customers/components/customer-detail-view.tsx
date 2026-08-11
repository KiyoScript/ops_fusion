"use client";

import Link from "next/link";
import { format } from "date-fns";
import { PencilIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { CustomerDetailDto } from "../schemas/customer";

const peso = (v: string | null) => {
  if (v === null) return "—";
  const n = parseFloat(v);
  return isNaN(n) ? v : `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
};
const d = (s: string) => format(new Date(s), "M/d/yyyy h:mma");
const pretty = (s: string) => s.replace(/_/g, " ").toLowerCase();

export function CustomerStatusBadge({ status }: { status: string }) {
  return status === "INACTIVE"
    ? <Badge variant="outline">Inactive</Badge>
    : <Badge variant="secondary">Active</Badge>;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm wrap-break-word">{value || "—"}</span>
    </div>
  );
}
function Empty({ what }: { what: string }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">No {what} yet.</p>;
}
function Num({ children }: { children: React.ReactNode }) {
  return <span className="font-mono font-medium">{children}</span>;
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
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <CustomerStatusBadge status={c.status} />
        {c.vatRegistered && <Badge variant="outline">VAT-registered</Badge>}
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

      <Tabs defaultValue="profile">
        <TabsList className="flex-wrap">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="quotations"><TabCount label="Quotations" n={c.counts.quotations} /></TabsTrigger>
          <TabsTrigger value="jobOrders"><TabCount label="Job Orders" n={c.counts.jobOrders} /></TabsTrigger>
          <TabsTrigger value="deliveries"><TabCount label="Deliveries" n={c.counts.deliveryReceipts} /></TabsTrigger>
          <TabsTrigger value="sales"><TabCount label="Sales" n={c.counts.sales} /></TabsTrigger>
          <TabsTrigger value="payments"><TabCount label="Payments" n={c.counts.collectionReceipts + c.counts.advancePayments} /></TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="grid gap-4 pt-2">
          <Card>
            <CardContent className="grid grid-cols-2 gap-3 pt-6 sm:grid-cols-3">
              <Field label="Contact number" value={c.contactNumber} />
              <Field label="Email" value={c.email} />
              <Field label="TIN" value={c.tin} />
              <Field label="Company" value={c.company} />
              <Field label="Credit terms" value={c.creditTermDays ? `${c.creditTermDays} days` : "No terms"} />
              <Field label="Credit limit" value={peso(c.creditLimit)} />
              <div className="col-span-2 sm:col-span-3"><Field label="Billing address" value={c.address} /></div>
              <div className="col-span-2 sm:col-span-3"><Field label="Shipping address" value={c.shippingAddress} /></div>
            </CardContent>
          </Card>
          {c.notes && <p className="rounded-lg bg-muted/50 p-3 text-sm whitespace-pre-line">{c.notes}</p>}
          <div className="grid grid-cols-3 gap-2 rounded-lg border p-3 sm:grid-cols-4 lg:grid-cols-7">
            <Stat label="Quotations" value={c.counts.quotations} />
            <Stat label="Job orders" value={c.counts.jobOrders} />
            <Stat label="Deliveries" value={c.counts.deliveryReceipts} />
            <Stat label="Sales" value={c.counts.sales} />
            <Stat label="Collections" value={c.counts.collectionReceipts} />
            <Stat label="Adv. pay" value={c.counts.advancePayments} />
            <Stat label="Inquiries" value={c.counts.inquiries} />
          </div>
          <p className="text-xs text-muted-foreground">
            Added by {c.createdByName} · {format(new Date(c.createdAt), "MMM d, yyyy · h:mm a")}
          </p>
        </TabsContent>

        <TabsContent value="quotations" className="pt-2">
          <DocTable head={["Quote #", "Status", "Total", "Date"]} rows={c.quotations} empty="quotations"
            render={(q) => (
              <>
                <TableCell><Num>{q.number}</Num></TableCell>
                <TableCell><Pill>{pretty(q.status)}</Pill></TableCell>
                <TableCell className="tabular-nums">{peso(q.total)}</TableCell>
                <TableCell className="text-muted-foreground">{d(q.createdAt)}</TableCell>
              </>
            )} />
        </TabsContent>

        <TabsContent value="jobOrders" className="pt-2">
          <DocTable head={["JO #", "Status", "Total", "Date"]} rows={c.jobOrders} empty="job orders"
            render={(j) => (
              <>
                <TableCell><Num>{j.number}</Num></TableCell>
                <TableCell><Pill>{pretty(j.status)}</Pill></TableCell>
                <TableCell className="tabular-nums">{peso(j.total)}</TableCell>
                <TableCell className="text-muted-foreground">{d(j.createdAt)}</TableCell>
              </>
            )} />
        </TabsContent>

        <TabsContent value="deliveries" className="pt-2">
          <DocTable head={["DR #", "Status", "Issued"]} rows={c.deliveries} empty="delivery receipts"
            render={(x) => (
              <>
                <TableCell><Num>{x.number}</Num></TableCell>
                <TableCell><Pill>{pretty(x.status)}</Pill></TableCell>
                <TableCell className="text-muted-foreground">{d(x.issuedAt)}</TableCell>
              </>
            )} />
        </TabsContent>

        <TabsContent value="sales" className="pt-2">
          <DocTable head={["Receipt #", "Payment", "Amount", "Date"]} rows={c.sales} empty="sales"
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
            <DocTable head={["CR #", "Amount", "Date"]} rows={c.collections} empty="collection receipts"
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
            <DocTable head={["Amount", "Status", "Date"]} rows={c.advancePayments} empty="advance payments"
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
