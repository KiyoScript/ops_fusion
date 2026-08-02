"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { fetchJson } from "@/lib/api-client";
import { sanitizeDecimal, sanitizeInteger } from "@/lib/form-numeric";
import {
  createMaterialAction,
  updateMaterialAction,
} from "@/app/(app)/inventory/actions";
import { useMaterialOptions, useInvalidateInventory } from "../hooks/use-inventory";
import type { MaterialDto } from "../schemas/material";

type FormState = {
  code: string;
  name: string;
  category: string;
  location: string;
  area: string;
  unit: string;
  packSize: string;
  unitCost: string;
  unitPrice: string;
  reorderLevel: string;
  supplierId: string;
  status: "ACTIVE" | "INACTIVE";
  possibleOffcut: boolean;
  openingQty: string;
  notes: string;
  unitOther: boolean; // UI flag: unit is a free-typed value, not a preset
};

const NO_SUPPLIER = "__none__";
const NEW_PREFIX = "__new_prefix__";
const UNIT_OTHER = "__other__";
// Common stock units for the shop; anything else → "Other…" (free text).
const UNIT_PRESETS = [
  "pc", "sheet", "ream", "roll", "bottle", "can", "pack",
  "box", "set", "meter", "sqft", "kg", "liter", "bundle",
];

const empty: FormState = {
  code: "", name: "", category: "", location: "", area: "",
  unit: "pc", packSize: "0", unitCost: "0", unitPrice: "",
  reorderLevel: "0", supplierId: NO_SUPPLIER, status: "ACTIVE",
  possibleOffcut: false, openingQty: "0", notes: "", unitOther: false,
};

function fromMaterial(m: MaterialDto): FormState {
  return {
    code: m.code,
    name: m.name,
    category: m.category ?? "",
    location: m.location ?? "",
    area: m.area ?? "",
    unit: m.unit,
    packSize: String(m.packSize),
    unitCost: m.unitCost,
    unitPrice: m.unitPrice ?? "",
    reorderLevel: String(m.reorderLevel),
    supplierId: m.supplier?.id ?? NO_SUPPLIER,
    status: m.status,
    possibleOffcut: m.possibleOffcut,
    openingQty: "0",
    notes: m.notes ?? "",
    unitOther: !UNIT_PRESETS.includes(m.unit),
  };
}

export function MaterialFormDialog({
  open,
  onOpenChange,
  material,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  material?: MaterialDto | null;
}) {
  const router = useRouter();
  const invalidate = useInvalidateInventory();
  const options = useMaterialOptions(open);
  const [form, setForm] = useState<FormState>(empty);
  const [prefixSel, setPrefixSel] = useState(""); // chosen prefix in the dropdown
  const [addingPrefix, setAddingPrefix] = useState(false);
  const [newPrefix, setNewPrefix] = useState("");
  const [pending, startTransition] = useTransition();
  const isEdit = !!material;

  // Seed the form when the dialog opens or switches item — synced at render
  // time (not in an effect) so the fields are correct on first paint.
  const formKey = open ? (material?.id ?? "new") : "closed";
  const [syncedKey, setSyncedKey] = useState(formKey);
  if (formKey !== syncedKey) {
    setSyncedKey(formKey);
    if (open) {
      setForm(material ? fromMaterial(material) : empty);
      setPrefixSel("");
      setAddingPrefix(false);
      setNewPrefix("");
    }
  }

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const suggestFor = async (prefix: string) => {
    try {
      const res = await fetchJson<{ suggestedCode: string | null }>(
        `/api/inventory/materials/options?prefix=${encodeURIComponent(prefix)}`
      );
      if (res.suggestedCode) set("code", res.suggestedCode);
    } catch {
      /* non-blocking suggestion */
    }
  };

  const submit = () => {
    const payload = {
      ...(isEdit ? { id: material!.id } : {}),
      code: form.code.trim(),
      name: form.name.trim(),
      category: form.category.trim() || undefined,
      location: form.location.trim() || undefined,
      area: form.area.trim() || undefined,
      unit: form.unit.trim() || "pc",
      packSize: form.packSize || "0",
      unitCost: form.unitCost || "0",
      unitPrice: form.unitPrice.trim() ? form.unitPrice : undefined,
      reorderLevel: form.reorderLevel || "0",
      supplierId: form.supplierId === NO_SUPPLIER ? undefined : form.supplierId,
      status: form.status,
      possibleOffcut: form.possibleOffcut,
      notes: form.notes.trim() || undefined,
      ...(isEdit ? {} : { openingQty: form.openingQty || "0" }),
    };
    startTransition(async () => {
      const result = isEdit
        ? await updateMaterialAction(payload)
        : await createMaterialAction(payload);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(isEdit ? "Item updated." : "Item added.");
      invalidate();
      router.refresh();
      onOpenChange(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit item" : "Add item"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update the item's master data. Stock is corrected via adjustments, not here."
              : "Item codes carry a prefix + number (e.g. PAP-001). Pick a prefix to auto-number, or type any code."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="mf-code">Item code</Label>
              <Input
                id="mf-code"
                value={form.code}
                onChange={(e) => set("code", e.target.value.toUpperCase())}
                placeholder="PAP-001"
                readOnly={isEdit}
                aria-readonly={isEdit}
                className={isEdit ? "cursor-not-allowed bg-muted font-mono text-muted-foreground" : "font-mono"}
              />
              {!isEdit && (
                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                  <Select
                    value={prefixSel}
                    onValueChange={(v) => {
                      if (!v) return;
                      if (v === NEW_PREFIX) {
                        setAddingPrefix(true);
                        setPrefixSel("");
                        return;
                      }
                      setAddingPrefix(false);
                      setPrefixSel(v);
                      suggestFor(v);
                    }}
                  >
                    <SelectTrigger className="h-7 w-44 text-xs" aria-label="Code prefix">
                      <SelectValue>
                        {(v) => (v && v !== NEW_PREFIX ? `${v}-…` : "Pick a prefix…")}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {(options.data?.prefixes ?? []).map((p) => (
                        <SelectItem key={p} value={p}>{p}</SelectItem>
                      ))}
                      <SelectItem value={NEW_PREFIX}>＋ New prefix…</SelectItem>
                    </SelectContent>
                  </Select>
                  {addingPrefix && (
                    <div className="flex items-center gap-1">
                      <Input
                        autoFocus
                        value={newPrefix}
                        onChange={(e) => setNewPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && newPrefix.trim()) {
                            e.preventDefault();
                            suggestFor(newPrefix.trim());
                            setPrefixSel(newPrefix.trim());
                            setAddingPrefix(false);
                            setNewPrefix("");
                          }
                        }}
                        placeholder="New prefix"
                        className="h-7 w-24 text-xs"
                        aria-label="New code prefix"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        disabled={!newPrefix.trim()}
                        onClick={() => {
                          suggestFor(newPrefix.trim());
                          setPrefixSel(newPrefix.trim());
                          setAddingPrefix(false);
                          setNewPrefix("");
                        }}
                      >
                        Add
                      </Button>
                    </div>
                  )}
                </div>
              )}
              {isEdit && (
                <p className="text-xs text-muted-foreground">
                  Item code is permanent — it can’t be changed.
                </p>
              )}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="mf-name">Item name</Label>
              <Input
                id="mf-name"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="Sample Paper A4"
              />
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor="mf-category">Category</Label>
              <Input id="mf-category" value={form.category} onChange={(e) => set("category", e.target.value)} placeholder="Paper" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="mf-location">Location</Label>
              <Input id="mf-location" value={form.location} onChange={(e) => set("location", e.target.value)} placeholder="Storeroom" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="mf-area">Area / bin</Label>
              <Input id="mf-area" value={form.area} onChange={(e) => set("area", e.target.value)} placeholder="Shelf A" />
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor="mf-unit">Unit (stock)</Label>
              <Select
                value={form.unitOther ? UNIT_OTHER : form.unit}
                onValueChange={(v) => {
                  if (v === UNIT_OTHER) setForm((f) => ({ ...f, unitOther: true, unit: "" }));
                  else setForm((f) => ({ ...f, unitOther: false, unit: v ?? "pc" }));
                }}
              >
                <SelectTrigger id="mf-unit" className="w-full">
                  <SelectValue>
                    {(v) => (v === UNIT_OTHER ? "Other…" : ((v as string) || "pc"))}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {UNIT_PRESETS.map((u) => (
                    <SelectItem key={u} value={u}>{u}</SelectItem>
                  ))}
                  <SelectItem value={UNIT_OTHER}>Other…</SelectItem>
                </SelectContent>
              </Select>
              {form.unitOther && (
                <Input
                  value={form.unit}
                  onChange={(e) => set("unit", e.target.value)}
                  placeholder="Type unit (e.g. gallon)"
                  className="mt-1"
                  aria-label="Custom unit"
                />
              )}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="mf-pack">Pack size (pcs/bundle)</Label>
              <Input id="mf-pack" inputMode="numeric" value={form.packSize} onChange={(e) => set("packSize", sanitizeInteger(e.target.value))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="mf-reorder">Reorder level (pcs)</Label>
              <Input id="mf-reorder" inputMode="numeric" value={form.reorderLevel} onChange={(e) => set("reorderLevel", sanitizeInteger(e.target.value))} />
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor="mf-cost">Unit cost (per pc)</Label>
              <Input id="mf-cost" inputMode="decimal" value={form.unitCost} onChange={(e) => set("unitCost", sanitizeDecimal(e.target.value))} className="text-right tabular-nums" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="mf-price">Price (per bundle)</Label>
              <Input id="mf-price" inputMode="decimal" value={form.unitPrice} onChange={(e) => set("unitPrice", sanitizeDecimal(e.target.value))} className="text-right tabular-nums" placeholder="optional" />
            </div>
            {!isEdit ? (
              <div className="grid gap-1.5">
                <Label htmlFor="mf-opening">Opening stock (pcs)</Label>
                <Input id="mf-opening" inputMode="numeric" value={form.openingQty} onChange={(e) => set("openingQty", sanitizeInteger(e.target.value))} className="text-right tabular-nums" />
              </div>
            ) : (
              <div className="grid gap-1.5">
                <Label>On hand (pcs)</Label>
                <div
                  className="flex h-9 items-center justify-end rounded-md border bg-muted px-3 text-sm tabular-nums text-muted-foreground"
                  aria-readonly
                >
                  {(material?.onHand ?? 0).toLocaleString()} {material?.unit}
                </div>
                <p className="text-xs text-muted-foreground">Change stock via an adjustment.</p>
              </div>
            )}
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="mf-supplier">Supplier</Label>
              <Select value={form.supplierId} onValueChange={(v) => set("supplierId", v ?? NO_SUPPLIER)}>
                <SelectTrigger id="mf-supplier" className="w-full">
                  <SelectValue>
                    {(v) =>
                      v === NO_SUPPLIER || !v
                        ? "— none —"
                        : (options.data?.suppliers.find((s) => s.id === v)?.name ?? "…")
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_SUPPLIER}>— none —</SelectItem>
                  {(options.data?.suppliers ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="mf-status">Status</Label>
              <Select value={form.status} onValueChange={(v) => set("status", v as FormState["status"])}>
                <SelectTrigger id="mf-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">Active</SelectItem>
                  <SelectItem value="INACTIVE">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Switch id="mf-offcut" checked={form.possibleOffcut} onCheckedChange={(v) => set("possibleOffcut", v)} />
            <Label htmlFor="mf-offcut" className="text-sm font-normal text-muted-foreground">
              Possible offcut — material can yield reusable offcuts (roll / large-format stock)
            </Label>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="mf-notes">Notes</Label>
            <Textarea id="mf-notes" rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </div>
        </div>

        <DialogFooter showCloseButton>
          <Button onClick={submit} disabled={pending || !form.code.trim() || !form.name.trim()}>
            {pending ? "Saving…" : isEdit ? "Save changes" : "Add item"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
