"use client";

import { useState, useTransition } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/data-states";
import { cn } from "@/lib/utils";
import { moveJoDeadlineAction } from "@/app/(app)/job-orders/actions";
import type { JobOrderItemRowDto } from "../schemas/job-order";
import {
  useInvalidateJobOrders,
  useJoCalendar,
} from "../hooks/use-job-orders";
import { ItemEditDialog } from "./item-edit-dialog";
import { JoEditDialog } from "./jo-edit-dialog";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Legend + day tints ported from the legacy JOCalendar (has-jo / has-overdue
// cell backgrounds, weekend date-number tints, today circle).
const LEGEND = [
  { label: "Today", swatch: "bg-primary" },
  { label: "Has Deadline", swatch: "bg-yellow-100 border border-yellow-300 dark:bg-yellow-500/20 dark:border-yellow-500/40" },
  { label: "Overdue Deadline", swatch: "bg-red-100 border border-red-300 dark:bg-red-500/20 dark:border-red-500/40" },
  { label: "Sunday", swatch: "bg-red-50 border border-red-300 dark:bg-red-500/10 dark:border-red-500/40" },
  { label: "Saturday", swatch: "bg-blue-50 border border-blue-300 dark:bg-blue-500/10 dark:border-blue-500/40" },
] as const;

/** Legacy JO Calendar: one pin per open item on its deadline day; drag a pin
 *  to another day to move the WHOLE JO's deadline (ADMIN/MANAGER only). */
export function JoCalendar({ canMove }: { canMove: boolean }) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1); // 1-based
  const [editingItem, setEditingItem] = useState<JobOrderItemRowDto | null>(null);
  const [editingJoId, setEditingJoId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const invalidate = useInvalidateJobOrders();
  const query = useJoCalendar(year, month);

  const byDate = new Map<string, JobOrderItemRowDto[]>();
  for (const row of query.data ?? []) {
    const key = row.deadline!.slice(0, 10);
    const list = byDate.get(key);
    if (list) list.push(row);
    else byDate.set(key, [row]);
  }

  const step = (delta: number) => {
    const d = new Date(year, month - 1 + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
  };

  const drop = (dateKey: string, event: React.DragEvent) => {
    event.preventDefault();
    setDropTarget(null);
    const payload = event.dataTransfer.getData("application/json");
    if (!payload) return;
    const { jobOrderId, joNumber } = JSON.parse(payload) as {
      jobOrderId: string;
      joNumber: string;
    };
    startTransition(async () => {
      const result = await moveJoDeadlineAction({ jobOrderId, newDate: dateKey });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.data.itemsMoved > 1
          ? `${joNumber}: deadline updated for ${result.data.itemsMoved} items.`
          : `${joNumber}: deadline updated.`
      );
      invalidate();
    });
  };

  // 6-week grid; leading/trailing cells belong to neighbor months (dimmed).
  const firstDay = new Date(year, month - 1, 1);
  const offset = firstDay.getDay();
  const cells = Array.from({ length: 42 }, (_, i) => {
    const date = new Date(year, month - 1, i - offset + 1);
    return {
      date,
      key: format(date, "yyyy-MM-dd"),
      inMonth: date.getMonth() === month - 1,
      isToday: format(date, "yyyy-MM-dd") === format(today, "yyyy-MM-dd"),
    };
  });

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon-sm" aria-label="Previous month" onClick={() => step(-1)}>
          <ChevronLeftIcon />
        </Button>
        <span className="min-w-40 text-center text-lg font-semibold">
          {format(firstDay, "MMMM yyyy")}
        </span>
        <Button variant="outline" size="icon-sm" aria-label="Next month" onClick={() => step(1)}>
          <ChevronRightIcon />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setYear(today.getFullYear());
            setMonth(today.getMonth() + 1);
          }}
        >
          Today
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">
          {canMove
            ? "Drag a JO to another day to move its deadline (all items move together)."
            : "Deadlines are view-only for your role."}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {LEGEND.map((entry) => (
          <span key={entry.label} className="flex items-center gap-1.5 text-xs">
            <span className={cn("size-3.5 rounded-full", entry.swatch)} />
            {entry.label}
          </span>
        ))}
      </div>

      {query.isError ? (
        <Card>
          <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
        </Card>
      ) : (
        <Card className="py-0">
          <CardContent className="overflow-x-auto px-0">
            <div className="grid min-w-4xl grid-cols-7 border-b text-center text-xs font-semibold text-muted-foreground">
              {WEEKDAYS.map((d) => (
                <div
                  key={d}
                  className={cn(
                    "py-2",
                    d === "Sun" && "text-red-600 dark:text-red-400",
                    d === "Sat" && "text-blue-600 dark:text-blue-400"
                  )}
                >
                  {d}
                </div>
              ))}
            </div>
            <div className="grid min-w-4xl grid-cols-7">
              {cells.map((cell) => {
                const pins = cell.inMonth ? (byDate.get(cell.key) ?? []) : [];
                const hasOverdue = pins.some((p) => p.isOverdue);
                const dow = cell.date.getDay();
                return (
                  <div
                    key={cell.key}
                    onDragOver={
                      canMove
                        ? (e) => {
                            e.preventDefault();
                            setDropTarget(cell.key);
                          }
                        : undefined
                    }
                    onDragLeave={canMove ? () => setDropTarget(null) : undefined}
                    onDrop={canMove ? (e) => drop(cell.key, e) : undefined}
                    className={cn(
                      "min-h-28 border-r border-b p-1.5 nth-[7n]:border-r-0",
                      !cell.inMonth && "bg-muted/40",
                      // Legacy has-jo / has-overdue cell tints (overdue wins)
                      pins.length > 0 &&
                        !hasOverdue &&
                        "bg-yellow-50 dark:bg-yellow-500/10",
                      hasOverdue && "bg-red-50 dark:bg-red-500/10",
                      dropTarget === cell.key && "bg-accent ring-2 ring-primary ring-inset"
                    )}
                  >
                    <span
                      className={cn(
                        "mb-1 inline-flex size-6 items-center justify-center rounded-full text-xs",
                        cell.isToday
                          ? "bg-primary font-semibold text-primary-foreground"
                          : !cell.inMonth
                            ? "text-muted-foreground"
                            : dow === 0
                              ? "bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-400"
                              : dow === 6
                                ? "bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400"
                                : "text-foreground"
                      )}
                    >
                      {cell.date.getDate()}
                    </span>
                    <div className="grid max-h-40 gap-1 overflow-y-auto">
                      {query.isPending && cell.inMonth ? (
                        <Skeleton className="h-5 w-full" />
                      ) : (
                        pins.map((pin) => (
                          <button
                            key={pin.id}
                            type="button"
                            draggable={canMove && !pending}
                            onDragStart={(e) =>
                              e.dataTransfer.setData(
                                "application/json",
                                JSON.stringify({
                                  jobOrderId: pin.jobOrderId,
                                  joNumber: pin.joNumber,
                                })
                              )
                            }
                            onClick={() => setEditingItem(pin)}
                            title={`${pin.customerName} — ${pin.description}`}
                            className={cn(
                              "w-full truncate rounded-md px-1.5 py-0.5 text-left text-xs font-medium",
                              pin.isOverdue
                                ? "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300"
                                : pin.isRush
                                  ? "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300"
                                  : "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300",
                              canMove && "cursor-grab active:cursor-grabbing"
                            )}
                          >
                            {pin.isRush ? "🔥 " : ""}
                            {pin.joNumber} · {pin.customerName}
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <ItemEditDialog
        row={editingItem}
        onClose={() => setEditingItem(null)}
        onEditJo={(joId) => {
          setEditingItem(null);
          setEditingJoId(joId);
        }}
      />
      <JoEditDialog
        jobOrderId={editingJoId}
        canDelete={canMove}
        onClose={() => setEditingJoId(null)}
      />
    </div>
  );
}
