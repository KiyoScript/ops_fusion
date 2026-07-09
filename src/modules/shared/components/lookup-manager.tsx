"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArchiveIcon, ArchiveRestoreIcon, PlusIcon, UploadIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/data-states";
import { fetchJson } from "@/lib/api-client";
import {
  createLookupAction,
  updateLookupAction,
} from "@/app/(app)/maintenance/job-orders/actions";
import type {
  LookupDto,
  LookupImportSummaryDto,
  LookupTypeInput,
} from "../schemas/lookup";

/** One maintained list (legacy DatabaseLink sheet equivalent). Entries are
 *  never hard-deleted: Archive hides them from pickers, Restore brings them
 *  back — history on job orders is untouched either way. */
export function LookupManager({
  type,
  title,
  description,
  items,
  withLFP = false,
  importConfig,
}: {
  type: LookupTypeInput;
  title: string;
  description: string;
  items: LookupDto[];
  withLFP?: boolean;
  /** Optional legacy-sheet import (e.g. OPSServices for categories). */
  importConfig?: { url: string; hint: string };
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [label, setLabel] = useState("");
  const [isLFP, setIsLFP] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();

  const active = items.filter((i) => i.isActive);
  const archived = items.filter((i) => !i.isActive);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["lookups", type] });
    router.refresh();
  };

  const add = () => {
    if (!label.trim()) {
      toast.error("Enter a value first.");
      return;
    }
    startTransition(async () => {
      const result = await createLookupAction({
        type,
        label: label.trim(),
        isLFP: withLFP ? isLFP : undefined,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Added "${result.data.label}".`);
      setLabel("");
      setIsLFP(false);
      refresh();
    });
  };

  const setArchived = (item: LookupDto, archive: boolean) => {
    startTransition(async () => {
      const result = await updateLookupAction({
        id: item.id,
        isActive: !archive,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        archive ? `"${item.label}" archived.` : `"${item.label}" restored.`
      );
      refresh();
    });
  };

  const importFile = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file || !importConfig) {
      toast.error("Choose a .csv or .xlsx file first.");
      return;
    }
    setImporting(true);
    try {
      const body = new FormData();
      body.set("file", file);
      const summary = await fetchJson<LookupImportSummaryDto>(
        importConfig.url,
        { method: "POST", body }
      );
      toast.success(
        `Imported ${summary.created} entr${summary.created === 1 ? "y" : "ies"}` +
          (summary.skippedExisting.length
            ? `, skipped ${summary.skippedExisting.length} existing`
            : "") +
          (summary.errors.length ? `, ${summary.errors.length} error(s)` : "") +
          "."
      );
      if (fileRef.current) fileRef.current.value = "";
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            placeholder={`Add to ${title.toLowerCase()}…`}
            className="max-w-72"
            aria-label={`New ${title} entry`}
          />
          {withLFP && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={isLFP}
                onChange={(e) => setIsLFP(e.target.checked)}
              />
              LFP (large format)
            </label>
          )}
          <Button size="sm" onClick={add} disabled={pending}>
            <PlusIcon /> Add
          </Button>
        </div>

        {importConfig && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-3">
            <UploadIcon className="size-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              {importConfig.hint}
            </span>
            <Input
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              ref={fileRef}
              className="max-w-64"
              aria-label={`${title} import file`}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={importFile}
              disabled={importing}
            >
              {importing ? "Importing…" : "Import file"}
            </Button>
          </div>
        )}

        {active.length === 0 ? (
          <EmptyState
            title="Nothing here yet"
            description="Entries you add appear in the matching dropdowns right away."
          />
        ) : (
          <ul className="grid gap-1">
            {active.map((item) => (
              <li
                key={item.id}
                className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm"
              >
                <span>{item.label}</span>
                {withLFP && item.isLFP && <Badge variant="outline">LFP</Badge>}
                <span className="ml-auto">
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => setArchived(item, true)}
                    disabled={pending}
                  >
                    <ArchiveIcon /> Archive
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}

        {archived.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              Archived ({archived.length})
            </summary>
            <ul className="mt-2 grid gap-1">
              {archived.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center gap-2 rounded-md border border-dashed px-3 py-1.5 text-sm text-muted-foreground"
                >
                  <span>{item.label}</span>
                  {withLFP && item.isLFP && <Badge variant="ghost">LFP</Badge>}
                  <span className="ml-auto">
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => setArchived(item, false)}
                      disabled={pending}
                    >
                      <ArchiveRestoreIcon /> Restore
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
