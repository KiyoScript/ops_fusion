"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  deleteNewspaperRowAction,
  createNewspaperRowAction,
  updateNewspaperRowAction,
} from "@/app/(app)/maintenance/newspaper/actions";
import type {
  NewspaperMaintenance,
  NewspaperRowView,
} from "@/modules/quotations/services/newspaper-pricing";
import { NewspaperCalculatorWorkflow } from "./newspaper-calculator-workflow";
import { NewspaperConstantsTab } from "./newspaper-constants-tab";
import { NewspaperApprovalsTab } from "./newspaper-approvals-tab";

const ALL = "__all__";

const php = (v: string | number) =>
  `₱${Number(v).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;

export function NewspaperPricingView({
  params,
  publications,
  rows,
  pending,
  history,
}: NewspaperMaintenance) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [pub, setPub] = useState(publications[0]?.name ?? "");
  const [kindF, setKindF] = useState<string>(ALL);
  const [pagesF, setPagesF] = useState<string>(ALL);
  const [copiesF, setCopiesF] = useState<string>(ALL);

  const selected = publications.find((p) => p.name === pub);

  const del = (id: string) => {
    start(async () => {
      const res = await deleteNewspaperRowAction(id);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Price row removed.");
      router.refresh();
    });
  };

  const pubRows = rows.filter((r) => r.publication === pub);
  const pageOptions = Array.from(
    new Set(pubRows.map((r) => r.totalPages).filter((n): n is number => n != null))
  ).sort((a, b) => a - b);
  const copyOptions = Array.from(new Set(pubRows.map((r) => r.copies))).sort(
    (a, b) => a - b
  );
  const shown = pubRows.filter(
    (r) =>
      (kindF === ALL || r.kind === kindF) &&
      (pagesF === ALL || String(r.totalPages ?? "") === pagesF) &&
      (copiesF === ALL || String(r.copies) === copiesF)
  );

  return (
    <Tabs defaultValue="calculator" className="gap-6">
      <TabsList>
        <TabsTrigger value="calculator">Calculator</TabsTrigger>
        <TabsTrigger value="prices">Price list</TabsTrigger>
        <TabsTrigger value="constants">Formula</TabsTrigger>
        <TabsTrigger value="approvals">
          Approvals
          {pending.length > 0 && (
            <span className="ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground">
              {pending.length}
            </span>
          )}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="calculator">
        <NewspaperCalculatorWorkflow
          publications={publications.map((p) => ({ id: p.id, name: p.name }))}
          params={params}
        />
      </TabsContent>

      <TabsContent value="prices" className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={pub}
            onValueChange={(v) => {
              setPub(v ?? "");
              setPagesF(ALL);
              setCopiesF(ALL);
            }}
          >
            <SelectTrigger aria-label="Publication">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {publications.map((p) => (
                <SelectItem key={p.id} value={p.name}>
                  {p.name} ({p.fullRows + p.looseRows})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={kindF} onValueChange={(v) => setKindF(v ?? ALL)}>
            <SelectTrigger aria-label="Filter by type">
              <SelectValue>
                {(v) =>
                  v === ALL
                    ? "All types"
                    : v === "FULL_ISSUE"
                      ? "Full issue"
                      : "Loose pages"
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All types</SelectItem>
              <SelectItem value="FULL_ISSUE">Full issue</SelectItem>
              <SelectItem value="LOOSE_PAGES">Loose pages</SelectItem>
            </SelectContent>
          </Select>
          <Select value={pagesF} onValueChange={(v) => setPagesF(v ?? ALL)}>
            <SelectTrigger aria-label="Filter by pages">
              <SelectValue>
                {(v) => (v === ALL ? "All pages" : `${String(v)} pages`)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All pages</SelectItem>
              {pageOptions.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n} pages
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={copiesF} onValueChange={(v) => setCopiesF(v ?? ALL)}>
            <SelectTrigger aria-label="Filter by copies">
              <SelectValue>
                {(v) => (v === ALL ? "All copies" : `${String(v)} copies`)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All copies</SelectItem>
              {copyOptions.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n} copies
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selected && (
            <div className="ml-auto">
              <NewspaperRowDialog
                publicationId={selected.id}
                publicationName={selected.name}
                onDone={() => router.refresh()}
              />
            </div>
          )}
        </div>

        <Card className="py-0">
          <CardContent className="overflow-x-auto px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kind</TableHead>
                  <TableHead className="text-right">Pages</TableHead>
                  <TableHead className="text-right">Color</TableHead>
                  <TableHead className="text-right">B/W</TableHead>
                  <TableHead className="text-right">Copies</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      No rows match these filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  shown.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {r.kind === "LOOSE_PAGES" ? "Loose" : "Full"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.totalPages ?? "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.colorPages}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.bwPages}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.copies}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {php(r.price)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.priceCode ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end">
                          {selected && (
                            <NewspaperRowDialog
                              publicationId={selected.id}
                              publicationName={selected.name}
                              row={r}
                              onDone={() => router.refresh()}
                            />
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Delete row"
                            disabled={busy}
                            onClick={() => del(r.id)}
                          >
                            <Trash2Icon />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="constants">
        <NewspaperConstantsTab params={params} />
      </TabsContent>

      <TabsContent value="approvals">
        <NewspaperApprovalsTab pending={pending} history={history} />
      </TabsContent>
    </Tabs>
  );
}

// Add / edit one price row for a publication (admin CRUD).
function NewspaperRowDialog({
  publicationId,
  publicationName,
  row,
  onDone,
}: {
  publicationId: string;
  publicationName: string;
  row?: NewspaperRowView;
  onDone: () => void;
}) {
  const mode = row ? "edit" : "create";
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [form, setForm] = useState({
    kind: (row?.kind ?? "FULL_ISSUE") as "FULL_ISSUE" | "LOOSE_PAGES",
    colorPages: row ? String(row.colorPages) : "",
    bwPages: row ? String(row.bwPages) : "",
    copies: row ? String(row.copies) : "",
    price: row ? row.price : "",
    priceCode: row?.priceCode ?? "",
  });
  const set = (k: keyof typeof form, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  const submit = () => {
    start(async () => {
      const payload = {
        kind: form.kind,
        colorPages: form.colorPages,
        bwPages: form.bwPages,
        copies: form.copies,
        price: form.price,
        priceCode: form.priceCode.trim() || undefined,
      };
      const res = row
        ? await updateNewspaperRowAction({ ...payload, id: row.id })
        : await createNewspaperRowAction({ ...payload, publicationId });
      if (!res.ok) return void toast.error(res.error);
      toast.success(row ? "Price row updated." : "Price row added.");
      setOpen(false);
      onDone();
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {mode === "create" ? (
        <DialogTrigger render={<Button variant="outline" size="sm" />}>
          <PlusIcon /> Add price row
        </DialogTrigger>
      ) : (
        <DialogTrigger
          render={<Button variant="ghost" size="icon" aria-label="Edit row" />}
        >
          <PencilIcon />
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {mode === "create"
              ? `Add ${publicationName} price row`
              : `Edit ${publicationName} price row`}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label className="text-xs">Kind</Label>
            <div className="flex flex-wrap gap-2">
              {(["FULL_ISSUE", "LOOSE_PAGES"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => set("kind", k)}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                    form.kind === k
                      ? "border-primary bg-primary text-primary-foreground"
                      : "hover:bg-accent"
                  )}
                >
                  {k === "FULL_ISSUE" ? "Full issue" : "Loose pages"}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <RowField label="Color pages" value={form.colorPages} onChange={(v) => set("colorPages", v)} />
            <RowField label="B/W pages" value={form.bwPages} onChange={(v) => set("bwPages", v)} />
            <RowField label="Copies" value={form.copies} onChange={(v) => set("copies", v)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <RowField label="Price (₱, net)" value={form.price} onChange={(v) => set("price", v)} decimal />
            <div className="grid gap-1.5">
              <Label className="text-xs">Price code (optional)</Label>
              <Input
                value={form.priceCode}
                onChange={(e) => set("priceCode", e.target.value)}
                placeholder="NEWSPAPER-BW-01"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Saved as a <strong>Custom</strong> row — survives a workbook
            re-import. Total pages = color + B/W (auto).
          </p>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button onClick={submit} disabled={pending}>
            {pending ? "Saving…" : mode === "create" ? "Add row" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RowField({
  label,
  value,
  onChange,
  decimal,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  decimal?: boolean;
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs">{label}</Label>
      <Input
        inputMode={decimal ? "decimal" : "numeric"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
