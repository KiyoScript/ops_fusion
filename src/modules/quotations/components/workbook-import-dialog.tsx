"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { FileSpreadsheetIcon } from "lucide-react";
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
import { useImportWorkbook } from "../hooks/use-price-import";
import type { WorkbookImportSummaryDto } from "../services/workbook-import-service";

/** One-click import of the whole legacy "Online Product specs" workbook —
 *  every product tab parsed in its own shape. */
export function WorkbookImportDialog() {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<WorkbookImportSummaryDto | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const importWorkbook = useImportWorkbook();

  const submit = () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      toast.error("Choose the .xlsx workbook first.");
      return;
    }
    importWorkbook.mutate(file, {
      onSuccess: (result) => {
        setSummary(result);
        toast.success(
          `Imported ${result.rulesCreated} rules across ${result.sheetsMatched} tabs.`
        );
      },
      onError: (err) => toast.error(err.message),
    });
  };

  const reset = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setSummary(null);
      importWorkbook.reset();
    }
  };

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger render={<Button />}>
        <FileSpreadsheetIcon /> Import full workbook
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import the price workbook</DialogTitle>
          <DialogDescription>
            Upload the whole <strong>Online Product specs (.xlsx)</strong> — every
            product tab (Mugs, Sticker, Frame, Acrylics, T-shirt, …) is read in
            its own format. Rules are replaced per product, so re-imports are
            safe.
          </DialogDescription>
        </DialogHeader>

        {summary ? (
          <ImportSummary summary={summary} />
        ) : (
          <div className="grid gap-2">
            <Label htmlFor="wb-file">Workbook (.xlsx)</Label>
            <Input
              id="wb-file"
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              ref={fileRef}
            />
          </div>
        )}

        <DialogFooter>
          {summary ? (
            <Button onClick={() => reset(false)}>Done</Button>
          ) : (
            <Button onClick={submit} disabled={importWorkbook.isPending}>
              {importWorkbook.isPending ? "Importing…" : "Import workbook"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportSummary({ summary }: { summary: WorkbookImportSummaryDto }) {
  return (
    <div className="grid gap-3 text-sm">
      <p>
        Imported <strong>{summary.rulesCreated}</strong> rules across{" "}
        <strong>{summary.sheetsMatched}</strong> tabs —{" "}
        <strong>{summary.productsCreated}</strong> new products,{" "}
        <strong>{summary.productsUpdated}</strong> updated.
      </p>
      <div className="max-h-56 overflow-y-auto rounded-md border">
        {summary.perSheet.map((s) => (
          <div
            key={s.sheet}
            className="flex items-center justify-between border-b px-3 py-1.5 last:border-0"
          >
            <span>{s.sheet}</span>
            <span className="text-xs text-muted-foreground">
              {s.products} product(s) · {s.rules} rule(s)
            </span>
          </div>
        ))}
      </div>
      {summary.skipped.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Skipped {summary.skipped.length} non-product tab(s):{" "}
          {summary.skipped.slice(0, 10).join(", ")}
          {summary.skipped.length > 10 ? "…" : ""}
        </p>
      )}
    </div>
  );
}
