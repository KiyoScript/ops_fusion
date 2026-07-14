"use client";

import { format } from "date-fns";
import { CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useItemSteps, useToggleItemStep } from "../hooks/use-item-steps";

/** Production-step checklist for one JO item (its per-product workflow).
 *  Ticking a step records who + when; the progress bar tracks completion. */
export function ItemStepsChecklist({
  jobOrderItemId,
  canEdit,
}: {
  jobOrderItemId: string;
  canEdit: boolean;
}) {
  const { data: steps, isPending } = useItemSteps(jobOrderItemId);
  const toggle = useToggleItemStep(jobOrderItemId);

  if (isPending) {
    return <p className="text-sm text-muted-foreground">Loading steps…</p>;
  }
  if (!steps || steps.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No production steps — set a workflow for this product in Quotation
        Maintenance.
      </p>
    );
  }

  const done = steps.filter((s) => s.doneAt !== null).length;

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Production steps</span>
        <span className="tabular-nums">
          {done}/{steps.length} done
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${(done / steps.length) * 100}%` }}
        />
      </div>
      <ul className="grid gap-1">
        {steps.map((step, i) => {
          const isDone = step.doneAt !== null;
          return (
            <li key={step.id}>
              <button
                type="button"
                disabled={!canEdit || toggle.isPending}
                onClick={() =>
                  toggle.mutate({ stepId: step.id, done: !isDone })
                }
                className={cn(
                  "flex w-full items-center gap-3 rounded-md border p-2 text-left text-sm",
                  isDone ? "bg-muted/40" : "hover:bg-accent",
                  !canEdit && "cursor-default"
                )}
              >
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full border text-xs",
                    isDone
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground"
                  )}
                >
                  {isDone ? <CheckIcon className="size-3" /> : i + 1}
                </span>
                <span className={cn("flex-1", isDone && "text-muted-foreground line-through")}>
                  {step.name}
                </span>
                {isDone && step.doneAt && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {step.doneByName ? `${step.doneByName} · ` : ""}
                    {format(new Date(step.doneAt), "MMM d")}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
