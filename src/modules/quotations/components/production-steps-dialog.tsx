"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ListChecksIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { saveProductionStepsAction } from "@/app/(app)/maintenance/quotations/actions";
import type { ProductOptionDto } from "@/modules/shared/hooks/use-products";

/** Edit a product's production workflow — the ordered steps a JO item of
 *  this product moves through. Saved replace-style; copied onto JO items
 *  when a quote converts. */
export function ProductionStepsDialog({
  product,
}: {
  product: ProductOptionDto;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [steps, setSteps] = useState<string[]>(product.productionSteps);
  const [pending, setPending] = useState(false);

  const reset = (next: boolean) => {
    setOpen(next);
    if (next) setSteps(product.productionSteps);
  };

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= steps.length) return;
    const next = [...steps];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setSteps(next);
  };

  const save = async () => {
    const clean = steps.map((s) => s.trim()).filter(Boolean);
    setPending(true);
    const result = await saveProductionStepsAction({
      productId: product.id,
      steps: clean,
    });
    setPending(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Production steps saved.");
    setOpen(false);
    queryClient.invalidateQueries({ queryKey: ["products"] });
  };

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="icon" aria-label={`Production steps for ${product.name}`} />
        }
      >
        <ListChecksIcon />
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Production steps — {product.name}</DialogTitle>
          <DialogDescription>
            The ordered workflow a job of this product goes through (e.g.
            Layout → Printing → Finishing). Copied onto each JO item when a
            quotation converts. Editing here won&apos;t change jobs already in
            production.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          {steps.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No steps yet — add the first one below.
            </p>
          )}
          {steps.map((step, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-5 shrink-0 text-center text-sm text-muted-foreground">
                {i + 1}
              </span>
              <Input
                value={step}
                onChange={(e) => {
                  const next = [...steps];
                  next[i] = e.target.value;
                  setSteps(next);
                }}
                placeholder="Step name"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Move up"
                disabled={i === 0}
                onClick={() => move(i, -1)}
              >
                <ArrowUpIcon className="size-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Move down"
                disabled={i === steps.length - 1}
                onClick={() => move(i, 1)}
              >
                <ArrowDownIcon className="size-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Remove step"
                onClick={() => setSteps(steps.filter((_, x) => x !== i))}
              >
                <Trash2Icon className="size-4" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={() => setSteps([...steps, ""])}
          >
            <PlusIcon /> Add step
          </Button>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Save steps"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
