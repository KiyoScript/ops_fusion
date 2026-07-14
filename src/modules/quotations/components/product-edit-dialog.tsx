"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  archivePriceListProductAction,
  savePriceListProductAction,
} from "@/app/(app)/maintenance/quotations/actions";
import {
  productSaveInput,
  type ProductSaveInput,
} from "../schemas/price-list";
import type { ProductOptionDto } from "@/modules/shared/hooks/use-products";

const EMPTY_RULE: ProductSaveInput["rules"][number] = {
  type: "VARIANT",
  label: "",
  unitPrice: "",
  minQty: "",
  minCharge: "",
  amount: "",
  pct: "",
  notes: "",
};

/** Add/edit one product + its whole rule set (saved replace-style, same
 *  semantics as the spreadsheet import). */
export function ProductEditDialog({ product }: { product?: ProductOptionDto }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [pendingArchive, setPendingArchive] = useState(false);
  const mode = product ? "edit" : "create";

  const form = useForm<ProductSaveInput>({
    resolver: zodResolver(productSaveInput),
    defaultValues: product
      ? {
          id: product.id,
          name: product.name,
          category: product.category,
          unit: product.unit,
          basePrice: parseFloat(product.basePrice) > 0 ? product.basePrice : "",
          description: product.description ?? "",
          rules: product.rules.map((rule) => ({
            type: rule.type,
            label: rule.label,
            unitPrice: rule.unitPrice ?? "",
            minQty: rule.minQty > 1 ? String(rule.minQty) : "",
            minCharge: rule.minCharge ?? "",
            amount: rule.amount ?? "",
            pct: rule.pct ?? "",
            notes: rule.notes ?? "",
          })),
        }
      : {
          name: "",
          category: "",
          unit: "pcs",
          basePrice: "",
          description: "",
          rules: [],
        },
  });
  const rules = useFieldArray({ control: form.control, name: "rules" });
  const watchedRules = useWatch({ control: form.control, name: "rules" });
  const { errors, isSubmitting } = form.formState;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["products"] });

  const onSubmit = form.handleSubmit(async (values) => {
    const result = await savePriceListProductAction(values);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(mode === "create" ? "Product added." : "Product updated.");
    setOpen(false);
    if (mode === "create") form.reset();
    refresh();
  });

  const archive = async () => {
    if (!product) return;
    setPendingArchive(true);
    const result = await archivePriceListProductAction(product.id);
    setPendingArchive(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(`${product.name} removed from the catalog.`);
    setOpen(false);
    refresh();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {mode === "create" ? (
        <DialogTrigger render={<Button variant="outline" />}>
          <PlusIcon /> Add product
        </DialogTrigger>
      ) : (
        <DialogTrigger
          render={<Button variant="ghost" size="icon" aria-label={`Edit ${product!.name}`} />}
        >
          <PencilIcon />
        </DialogTrigger>
      )}
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Add product" : `Edit ${product!.name}`}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_10rem_6rem_7rem]">
            <div className="grid gap-1">
              <Label htmlFor="pe-name">Product name</Label>
              <Input
                id="pe-name"
                aria-invalid={!!errors.name}
                {...form.register("name")}
              />
              {errors.name && (
                <p className="text-sm text-destructive">{errors.name.message}</p>
              )}
            </div>
            <div className="grid gap-1">
              <Label htmlFor="pe-category">Category</Label>
              <Input
                id="pe-category"
                aria-invalid={!!errors.category}
                {...form.register("category")}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="pe-unit">Unit</Label>
              <Input id="pe-unit" {...form.register("unit")} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="pe-base">Base price</Label>
              <Input
                id="pe-base"
                inputMode="decimal"
                placeholder="auto"
                {...form.register("basePrice")}
              />
            </div>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="pe-desc">Description / remarks</Label>
            <Input id="pe-desc" {...form.register("description")} />
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label>Price rules (variants, tiers, add-on fees)</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => rules.append(EMPTY_RULE)}
              >
                <PlusIcon /> Add rule
              </Button>
            </div>
            {rules.fields.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No rules — the product prices manually at its base price.
              </p>
            )}
            {rules.fields.map((field, index) => {
              const type = watchedRules?.[index]?.type ?? "VARIANT";
              return (
                <div
                  key={field.id}
                  className="grid gap-2 rounded-lg border p-2 sm:grid-cols-[7rem_1fr_auto]"
                >
                  <Controller
                    control={form.control}
                    name={`rules.${index}.type`}
                    render={({ field: tf }) => (
                      <Select
                        value={tf.value}
                        onValueChange={(v) => tf.onChange(v ?? "VARIANT")}
                      >
                        <SelectTrigger aria-label="Rule type">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="VARIANT">Variant</SelectItem>
                          <SelectItem value="ADDON">Add-on fee</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  />
                  <div className="grid gap-2 sm:grid-cols-[1fr_6rem_5rem_6rem]">
                    <Input
                      placeholder="Label (e.g. White Mug, Rush fee)"
                      aria-invalid={!!errors.rules?.[index]?.label}
                      {...form.register(`rules.${index}.label`)}
                    />
                    {type === "VARIANT" ? (
                      <>
                        <Input
                          placeholder="Price"
                          inputMode="decimal"
                          aria-invalid={!!errors.rules?.[index]?.unitPrice}
                          {...form.register(`rules.${index}.unitPrice`)}
                        />
                        <Input
                          placeholder="Min qty"
                          inputMode="numeric"
                          {...form.register(`rules.${index}.minQty`)}
                        />
                        <Input
                          placeholder="Min ₱"
                          inputMode="decimal"
                          {...form.register(`rules.${index}.minCharge`)}
                        />
                      </>
                    ) : (
                      <>
                        <Input
                          placeholder="Amount ₱"
                          inputMode="decimal"
                          aria-invalid={!!errors.rules?.[index]?.amount}
                          {...form.register(`rules.${index}.amount`)}
                        />
                        <Input
                          placeholder="%"
                          inputMode="decimal"
                          {...form.register(`rules.${index}.pct`)}
                        />
                        <Input
                          placeholder="Notes"
                          {...form.register(`rules.${index}.notes`)}
                        />
                      </>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove rule ${index + 1}`}
                    onClick={() => rules.remove(index)}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              );
            })}
            {typeof errors.rules?.message === "string" && (
              <p className="text-sm text-destructive">{errors.rules.message}</p>
            )}
          </div>

          <DialogFooter className="sm:justify-between">
            {mode === "edit" ? (
              <Button
                type="button"
                variant="destructive"
                onClick={archive}
                disabled={pendingArchive || isSubmitting}
              >
                {pendingArchive ? "Removing…" : "Remove product"}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Saving…" : "Save"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
