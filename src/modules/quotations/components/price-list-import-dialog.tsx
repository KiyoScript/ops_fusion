"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { DownloadIcon, UploadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useImportPriceList } from "../hooks/use-price-import";
import {
  PRICE_LIST_COLUMNS,
  type PriceImportSummaryDto,
} from "../schemas/price-list";

// Example rows shipped inside the downloadable template so the sheet's
// shape is self-explanatory (VARIANT tiers + an ADDON fee).
const TEMPLATE_ROWS = [
  ["Tarpaulin", "Large Format", "sqft", "VARIANT", "Standard rate", "50", "", "", "", "", ""],
  ["Tarpaulin", "Large Format", "sqft", "ADDON", "Rush fee", "", "", "", "150", "", ""],
  ["Tarpaulin", "Large Format", "sqft", "ADDON", "Design fee", "", "", "", "250", "", ""],
  ["Mug", "Souvenirs", "pc", "VARIANT", "White Mug", "180", "5", "", "", "", ""],
  ["Mug", "Souvenirs", "pc", "VARIANT", "White Mug", "150", "10", "", "", "", ""],
  ["ID Printing", "Printing", "pc", "ADDON", "Rush fee", "", "", "", "250", "5", "flat 250 or +5%"],
];

function downloadTemplate() {
  const csv = [PRICE_LIST_COLUMNS, ...TEMPLATE_ROWS]
    .map((row) => row.join(","))
    .join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "price-list-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export function PriceListImportDialog() {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<PriceImportSummaryDto | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const importPrices = useImportPriceList();

  const submit = () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      toast.error("Choose a .csv or .xlsx file first.");
      return;
    }
    importPrices.mutate(file, {
      onSuccess: (result) => {
        setSummary(result);
        toast.success(
          `Imported ${result.rulesCreated} price rules (${result.productsCreated} new products).`
        );
      },
      onError: (err) => toast.error(err.message),
    });
  };

  const reset = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setSummary(null);
      importPrices.reset();
    }
  };

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger render={<Button />}>
        <UploadIcon /> Import price list
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import from the price spreadsheet</DialogTitle>
          <DialogDescription>
            One row per price rule: {PRICE_LIST_COLUMNS.join(" · ")}. Upload
            .csv or .xlsx (the right tab is picked automatically). Products
            are created as needed; rules of every product in the file are
            <strong> replaced</strong>, so re-imports are safe.
          </DialogDescription>
        </DialogHeader>

        {summary ? (
          <ImportSummary summary={summary} />
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="price-import-file">File (.csv or .xlsx)</Label>
              <Input
                id="price-import-file"
                type="file"
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                ref={fileRef}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-fit"
              onClick={downloadTemplate}
            >
              <DownloadIcon /> Download CSV template
            </Button>
          </div>
        )}

        <DialogFooter>
          {summary ? (
            <Button onClick={() => reset(false)}>Done</Button>
          ) : (
            <Button onClick={submit} disabled={importPrices.isPending}>
              {importPrices.isPending ? "Importing…" : "Import"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportSummary({ summary }: { summary: PriceImportSummaryDto }) {
  return (
    <div className="grid gap-2 text-sm">
      <p>
        Imported <strong>{summary.rulesCreated}</strong> price rules —{" "}
        <strong>{summary.productsCreated}</strong> new products,{" "}
        <strong>{summary.productsUpdated}</strong> updated.
      </p>
      {summary.errors.length > 0 && (
        <div className="max-h-40 overflow-y-auto rounded-md border border-destructive/30 p-2">
          <p className="mb-1 font-medium text-destructive">
            {summary.errors.length} row(s) skipped:
          </p>
          <ul className="grid gap-1 text-xs text-muted-foreground">
            {summary.errors.map((err, i) => (
              <li key={i}>
                Line {err.line}: {err.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
