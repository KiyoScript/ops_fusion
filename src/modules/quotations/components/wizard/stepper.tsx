"use client";

import { CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type WizardStep = { label: string; sub?: string };

/** Legacy-style numbered stepper: done steps are red with a check, the
 *  active step is ringed, upcoming steps are muted. Done steps are
 *  clickable to jump back. */
export function Stepper({
  steps,
  current,
  onJump,
}: {
  steps: WizardStep[];
  current: number;
  onJump?: (index: number) => void;
}) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto rounded-lg border bg-muted/40 p-4">
      {steps.map((step, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={step.label} className="flex flex-1 items-center gap-2">
            <button
              type="button"
              disabled={!done}
              onClick={() => done && onJump?.(i)}
              className={cn(
                "flex flex-col items-center gap-1.5",
                done && "cursor-pointer"
              )}
            >
              <span
                className={cn(
                  "flex size-9 items-center justify-center rounded-full border-2 text-sm font-bold transition",
                  done && "border-primary bg-primary text-primary-foreground",
                  active &&
                    "border-background bg-background text-foreground shadow-[0_0_0_4px_var(--ring)]",
                  !done && !active && "border-border bg-muted text-muted-foreground"
                )}
              >
                {done ? <CheckIcon className="size-4" /> : i + 1}
              </span>
              <span
                className={cn(
                  "text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap",
                  active
                    ? "text-primary"
                    : done
                      ? "text-muted-foreground"
                      : "text-muted-foreground/60"
                )}
              >
                {step.label}
              </span>
            </button>
            {i < steps.length - 1 && (
              <div
                className={cn(
                  "mb-5 h-px flex-1",
                  done ? "bg-primary" : "bg-border"
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
