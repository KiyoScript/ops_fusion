"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PlusIcon, CheckCircle2Icon, AlertCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useDebounce } from "@/modules/shared/hooks/use-debounce";
import { useNewspaperPrice } from "@/modules/quotations/hooks/use-newspaper";
import {
  computeFormula,
  type FormulaParams,
} from "@/modules/quotations/services/newspaper-formula";
import {
  submitNewspaperPriceAction,
  createNewspaperPublicationAction,
} from "@/app/(app)/maintenance/newspaper/actions";

type Pub = { id: string; name: string };

const php = (v: number) =>
  `₱${v.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const int = (v: string) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export function NewspaperCalculatorWorkflow({
  publications,
  params,
}: {
  publications: Pub[];
  params: FormulaParams;
}) {
  const router = useRouter();
  // Base UI Select.Value renders the raw value, so key by the (unique) name.
  const [pubName, setPubName] = useState(publications[0]?.name ?? "");
  const publicationId = publications.find((p) => p.name === pubName)?.id ?? "";
  const [kind, setKind] = useState<"FULL_ISSUE" | "LOOSE_PAGES">("FULL_ISSUE");
  const [copies, setCopies] = useState("300");
  const [pages, setPages] = useState("12");
  const [colored, setColored] = useState("8");
  const [priceInput, setPriceInput] = useState("");
  const [priceCode, setPriceCode] = useState("");
  const [pending, setPending] = useState(false);

  const nCopies = int(copies);
  const nPages = int(pages);
  const nColored = Math.max(0, parseInt(colored, 10) || 0);
  const nBw = Math.max(0, nPages - nColored);
  const coloredInvalid = nColored > nPages;
  const ready = !!publicationId && nCopies > 0 && nPages > 0 && !coloredInvalid;

  // Live existence check (exact table hit → formula fallback), debounced.
  const debounced = useDebounce({
    publicationId,
    kind,
    colorPages: nColored,
    bwPages: nBw,
    copies: nCopies,
  });
  const priceQ = useNewspaperPrice(debounced);
  const lookup = ready ? priceQ.data : null;
  const exists = lookup?.source === "TABLE";

  // Formula (the guide) — uses the admin-saved constants (edited in their tab).
  const local = computeFormula(
    { copies: nCopies, totalPages: nPages, colorPages: nColored, bwPages: nBw },
    params
  );
  const suggested = exists && lookup ? lookup.total : local.total;
  const pubLabel = pubName || "this publication";

  const submit = async () => {
    if (!ready) return;
    const price = priceInput.trim() ? Number(priceInput) : suggested;
    if (!Number.isFinite(price) || price <= 0) {
      return void toast.error("Enter a valid price.");
    }
    setPending(true);
    const res = await submitNewspaperPriceAction({
      publicationId,
      kind,
      totalPages: nPages,
      colorPages: nColored,
      copies: nCopies,
      price,
      priceCode: priceCode.trim() || undefined,
    });
    setPending(false);
    if (!res.ok) return void toast.error(res.error);
    toast.success("Submitted for admin approval.");
    setPriceInput("");
    setPriceCode("");
    router.refresh();
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <div className="grid gap-1">
          <CardTitle>Price calculator</CardTitle>
          <p className="text-sm text-muted-foreground">
            Check if a size already has a price, or submit a new one — additions
            and changes need admin approval.
          </p>
        </div>
        <AddPublicationDialog onDone={() => router.refresh()} />
      </CardHeader>
      <CardContent className="grid gap-5">
        {/* Selectors */}
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="grid gap-1.5">
            <Label className="text-xs">Newspaper customer</Label>
            <Select value={pubName} onValueChange={(v) => setPubName(v ?? "")}>
              <SelectTrigger className="w-full" aria-label="Newspaper customer">
                <SelectValue placeholder="Select a publication" />
              </SelectTrigger>
              <SelectContent>
                {publications.map((p) => (
                  <SelectItem key={p.id} value={p.name}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">Issue type</Label>
            <div className="flex gap-2">
              {(
                [
                  ["FULL_ISSUE", "Full issue"],
                  ["LOOSE_PAGES", "Loose pages"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                    kind === k
                      ? "border-primary bg-primary text-primary-foreground"
                      : "hover:bg-accent"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Inputs — B/W is derived (pages − colored) and disabled */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <NumField label="# of Copies" value={copies} onChange={setCopies} />
          <NumField label="# of Pages" value={pages} onChange={setPages} />
          <NumField
            label="# of Colored"
            value={colored}
            onChange={setColored}
            invalid={coloredInvalid}
          />
          <div className="grid gap-1.5">
            <Label className="text-xs text-muted-foreground">
              # of B/W <span className="font-normal">(auto)</span>
            </Label>
            <Input
              value={coloredInvalid ? "—" : nBw}
              disabled
              readOnly
              className="tabular-nums"
            />
          </div>
        </div>
        {coloredInvalid && (
          <p className="-mt-2 text-sm text-destructive">
            Colored pages ({nColored}) can&apos;t be more than the number of pages
            ({nPages}).
          </p>
        )}

        {/* Result */}
        {!ready ? (
          <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
            Enter copies, pages, and colored pages to check the price.
          </p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
            {/* existence notice */}
            <div
              className={cn(
                "grid content-start gap-2 rounded-lg border p-4",
                exists
                  ? "border-emerald-300 bg-emerald-50/50 dark:border-emerald-900/60 dark:bg-emerald-950/20"
                  : "border-amber-300 bg-amber-50/50 dark:border-amber-900/60 dark:bg-amber-950/20"
              )}
            >
              {exists ? (
                <>
                  <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                    <CheckCircle2Icon className="size-4" /> Already in {pubLabel}
                  </div>
                  <div className="text-2xl font-bold tabular-nums">
                    {php(lookup!.total)}
                    <span className="ml-2 text-sm font-normal text-muted-foreground">
                      {php(lookup!.perCopy)}/copy
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Need to change this price? Enter a new one below — it needs
                    admin approval.
                  </p>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-300">
                    <AlertCircleIcon className="size-4" /> Not in {pubLabel} yet
                  </div>
                  <div className="text-2xl font-bold tabular-nums">
                    {php(local.total)}
                    <span className="ml-2 text-sm font-normal text-muted-foreground">
                      {php(local.perCopy)}/copy · formula estimate
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Submit this size for admin approval to add it to {pubLabel}.
                  </p>
                </>
              )}
            </div>

            {/* formula breakdown (guide) */}
            <div className="overflow-hidden rounded-lg border">
              <div className="border-b bg-muted/40 px-3 py-2 text-xs font-semibold text-muted-foreground">
                How the estimate is built (guide)
              </div>
              <table className="w-full text-sm [&_td]:px-3 [&_td]:py-1.5">
                <tbody>
                  <BreakRow label={`Plates (${local.breakdown.totalPlates})`} value={local.breakdown.plateCost} />
                  <BreakRow label="Labor" value={local.breakdown.laborCost} />
                  <BreakRow label={`Paper (${local.breakdown.paperSheets} sheets)`} value={local.breakdown.paperCost} />
                  <BreakRow label="Running" value={local.breakdown.runningCost} />
                  <BreakRow label="Subtotal" value={local.breakdown.subtotal} />
                  <BreakRow label={`Margin (${params.marginPct * 100}%)`} value={local.breakdown.margin} />
                  <tr className="border-t bg-muted/30 font-semibold">
                    <td>Formula total</td>
                    <td className="text-right tabular-nums">{php(local.total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Submit */}
        {ready && (
          <div className="flex flex-wrap items-end gap-3 border-t pt-4">
            <div className="grid gap-1.5">
              <Label className="text-xs">
                {exists ? "New price (₱)" : "Proposed price (₱)"}
              </Label>
              <Input
                inputMode="decimal"
                value={priceInput}
                onChange={(e) => setPriceInput(e.target.value)}
                placeholder={suggested.toFixed(2)}
                className="w-40 tabular-nums"
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Price code (optional)</Label>
              <Input
                value={priceCode}
                onChange={(e) => setPriceCode(e.target.value)}
                placeholder="NEWSPAPER-BW-01"
                className="w-48"
              />
            </div>
            <Button onClick={submit} disabled={pending} className="ml-auto">
              {pending
                ? "Submitting…"
                : exists
                  ? "Submit change for approval"
                  : "Submit for approval"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function NumField({
  label,
  value,
  onChange,
  invalid,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs">{label}</Label>
      <Input
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid}
        className="tabular-nums"
      />
    </div>
  );
}

function BreakRow({ label, value }: { label: string; value: number }) {
  return (
    <tr className="border-b last:border-b-0">
      <td className="text-muted-foreground">{label}</td>
      <td className="text-right tabular-nums">{php(value)}</td>
    </tr>
  );
}

function AddPublicationDialog({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);

  const save = async () => {
    setPending(true);
    const res = await createNewspaperPublicationAction({ name });
    setPending(false);
    if (!res.ok) return void toast.error(res.error);
    toast.success("Newspaper customer added.");
    setName("");
    setOpen(false);
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <PlusIcon /> Add newspaper
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add newspaper customer</DialogTitle>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label className="text-xs">Name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Leyte Samar Daily"
            autoFocus
          />
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button onClick={save} disabled={pending || !name.trim()}>
            {pending ? "Adding…" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
