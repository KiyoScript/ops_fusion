"use client";

import { format } from "date-fns";
import { toast } from "sonner";
import { CheckIcon, ListChecksIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { elapsed } from "./status-history-timeline";
import {
  useApplyItemWorkflow,
  useItemSteps,
  useToggleItemStep,
} from "../hooks/use-item-steps";

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
  const apply = useApplyItemWorkflow(jobOrderItemId);

  if (isPending) {
    return <p className="text-sm text-muted-foreground">Loading steps…</p>;
  }
  if (!steps || steps.length === 0) {
    return (
      <div className="grid gap-2">
        <p className="text-sm text-muted-foreground">
          No production steps yet. Workflows are set per product in JO
          Maintenance → Production workflows — items pick them up on
          conversion, or apply one here.
        </p>
        {canEdit && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit"
            disabled={apply.isPending}
            onClick={() =>
              apply.mutate(undefined, {
                onSuccess: ({ count }) =>
                  toast.success(
                    `Applied ${count} step${count === 1 ? "" : "s"} from the product's workflow.`
                  ),
                onError: (err) =>
                  toast.error(
                    err instanceof Error ? err.message : "Could not apply the workflow."
                  ),
              })
            }
          >
            <ListChecksIcon />
            {apply.isPending ? "Applying…" : "Apply product workflow"}
          </Button>
        )}
      </div>
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
          // Elapsed time since the PREVIOUS completed step (workflow order) —
          // same "+2h 15m" language the status timeline uses.
          const prevDoneAt = steps
            .slice(0, i)
            .reverse()
            .find((s) => s.doneAt !== null)?.doneAt;
          const gap =
            isDone && step.doneAt && prevDoneAt
              ? elapsed(new Date(prevDoneAt), new Date(step.doneAt))
              : null;
          return (
            <li key={step.id} className="grid gap-1">
              {gap && (
                <span
                  className="grid grid-cols-[20px_1fr] items-center gap-x-3 px-2"
                  aria-label={`${gap.slice(1)} after the previous step`}
                >
                  <span className="h-3 justify-self-center border-l border-border" />
                  <Badge variant="ghost" className="w-fit text-[0.7rem]">
                    {gap}
                  </Badge>
                </span>
              )}
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
                    {format(new Date(step.doneAt), "MMM d, h:mm a")}
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
