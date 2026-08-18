"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PlusIcon, SaveIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { saveGlobalAddonsAction } from "@/app/(app)/maintenance/quotations/actions";

export type AddonDto = {
  label: string;
  amount: string | null;
  pct: string | null;
  scope: "PER_LINE_ITEM" | "WHOLE_JO";
  notes: string | null;
};

type AddonRow = {
  label: string;
  mode: "FIXED" | "PCT";
  value: string;
  scope: "PER_LINE_ITEM" | "WHOLE_JO";
  notes: string;
};

export function AddonsMaintenanceView({
  addons,
  canMaintain,
}: {
  addons: AddonDto[];
  canMaintain: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<AddonRow[]>(
    addons.map((a) => ({
      label: a.label,
      mode: a.pct ? "PCT" : "FIXED",
      value: (a.pct ? a.pct : a.amount) ?? "",
      scope: a.scope,
      notes: a.notes ?? "",
    }))
  );
  const [saving, setSaving] = useState(false);

  const setRow = (i: number, patch: Partial<AddonRow>) =>
    setRows((rs) => rs.map((r, x) => (x === i ? { ...r, ...patch } : r)));

  const save = async () => {
    setSaving(true);
    const result = await saveGlobalAddonsAction({
      addons: rows
        .filter((r) => r.label.trim())
        .map((r) => ({
          label: r.label,
          amount: r.mode === "FIXED" ? r.value : "",
          pct: r.mode === "PCT" ? r.value : "",
          scope: r.scope,
          notes: r.notes,
        })),
    });
    setSaving(false);
    if (!result.ok) return void toast.error(result.error);
    toast.success("Add-ons saved.");
    router.refresh();
  };

  return (
    <Card>
      <CardContent className="grid gap-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            Fees offered on every product. <strong>Per line item</strong> add-ons
            (e.g. design fee) attach to each quote line; <strong>Whole JO</strong>{" "}
            add-ons (e.g. delivery fee) apply once to the whole quotation. A global
            add-on overrides a product&apos;s own add-on of the same name.
          </p>
          {canMaintain && (
            <Button onClick={save} disabled={saving} size="sm">
              <SaveIcon /> {saving ? "Saving…" : "Save"}
            </Button>
          )}
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[44rem]">
            <div className="grid grid-cols-[1fr_8rem_6rem_9rem_1fr_2.5rem] gap-2 border-b pb-1 text-xs font-medium text-muted-foreground">
              <span>Label</span>
              <span>Type</span>
              <span>Value</span>
              <span>Applies to</span>
              <span>Notes</span>
              <span className="sr-only">Remove</span>
            </div>
            <div className="grid gap-1.5 pt-2">
              {rows.length === 0 && (
                <p className="py-2 text-sm text-muted-foreground">
                  No add-ons yet — add fees like Rush, Design, or Delivery fee.
                </p>
              )}
              {rows.map((r, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[1fr_8rem_6rem_9rem_1fr_2.5rem] items-center gap-2"
                >
                  <Input
                    value={r.label}
                    onChange={(e) => setRow(i, { label: e.target.value })}
                    placeholder="e.g. Delivery fee"
                    readOnly={!canMaintain}
                  />
                  <Select
                    value={r.mode}
                    onValueChange={(v) =>
                      canMaintain && setRow(i, { mode: (v as AddonRow["mode"]) ?? "FIXED" })
                    }
                    disabled={!canMaintain}
                  >
                    <SelectTrigger aria-label="Pricing type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FIXED">Fixed ₱</SelectItem>
                      <SelectItem value="PCT">Percentage %</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    inputMode="decimal"
                    value={r.value}
                    onChange={(e) => setRow(i, { value: e.target.value })}
                    placeholder={r.mode === "PCT" ? "%" : "Amount"}
                    readOnly={!canMaintain}
                    className="tabular-nums"
                  />
                  <Select
                    value={r.scope}
                    onValueChange={(v) =>
                      canMaintain &&
                      setRow(i, { scope: (v as AddonRow["scope"]) ?? "PER_LINE_ITEM" })
                    }
                    disabled={!canMaintain}
                  >
                    <SelectTrigger aria-label="Applies to">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PER_LINE_ITEM">Per line item</SelectItem>
                      <SelectItem value="WHOLE_JO">Whole JO</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    value={r.notes}
                    onChange={(e) => setRow(i, { notes: e.target.value })}
                    placeholder="Notes"
                    readOnly={!canMaintain}
                  />
                  {canMaintain && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove add-on ${i + 1}`}
                      onClick={() => setRows((rs) => rs.filter((_, x) => x !== i))}
                    >
                      <Trash2Icon className="size-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {canMaintain && (
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setRows((rs) => [
                  ...rs,
                  { label: "", mode: "FIXED", value: "", scope: "PER_LINE_ITEM", notes: "" },
                ])
              }
            >
              <PlusIcon /> Add add-on
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
