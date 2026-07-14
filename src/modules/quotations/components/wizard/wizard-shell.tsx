"use client";

import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Stepper, type WizardStep } from "./stepper";

/** Frame every per-product wizard shares: header, stepper, the current
 *  step's titled card, and the Back / Continue footer. The parent owns the
 *  step index and validates each step in `onNext`. */
export function WizardShell({
  title,
  subtitle,
  badge,
  steps,
  current,
  onJump,
  onBack,
  onNext,
  nextLabel,
  nextDisabled,
  children,
}: {
  title: React.ReactNode;
  subtitle: string;
  badge?: string;
  steps: WizardStep[];
  current: number;
  onJump: (index: number) => void;
  onBack: () => void;
  onNext: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  children: React.ReactNode;
}) {
  const step = steps[current]!;
  const isLast = current === steps.length - 1;

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <div>
        <h1 className="flex items-center gap-3 text-2xl font-bold">
          {title}
          {badge && (
            <span className="rounded bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
              {badge}
            </span>
          )}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      </div>

      <Stepper steps={steps} current={current} onJump={onJump} />

      <Card className="overflow-hidden py-0">
        <div className="flex items-center gap-3 border-b bg-card px-5 py-4">
          <span className="flex size-9 items-center justify-center rounded bg-primary text-sm font-bold text-primary-foreground">
            {current + 1}
          </span>
          <div>
            <p className="font-semibold uppercase tracking-wide">{step.label}</p>
            {step.sub && (
              <p className="text-xs text-muted-foreground">{step.sub}</p>
            )}
          </div>
        </div>

        <CardContent className="py-6">{children}</CardContent>

        <div className="flex items-center justify-between border-t bg-muted/40 px-5 py-4">
          <Button
            type="button"
            variant="ghost"
            onClick={onBack}
            disabled={current === 0}
          >
            <ArrowLeftIcon /> Back
          </Button>
          <div className="flex items-center gap-4">
            <span className="text-xs text-muted-foreground">
              Step {current + 1} of {steps.length}
            </span>
            <Button type="button" onClick={onNext} disabled={nextDisabled}>
              {nextLabel ?? (isLast ? "Create quotation" : "Continue")}
              {!isLast && <ArrowRightIcon />}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
