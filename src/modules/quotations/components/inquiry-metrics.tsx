"use client";

import { InboxIcon, FileTextIcon, XCircleIcon, LayersIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ColorBadge } from "@/components/color-badge";
import { useInquiryMetrics } from "../hooks/use-inquiries";

const MEDIUM_LABELS: Record<string, string> = {
  WALK_IN: "Walk-in",
  MESSENGER: "Messenger",
  CALL: "Call",
  EMAIL: "Email",
  VIBER: "Viber",
  PORTAL: "Portal",
};

// Inquiry dashboard — status counts + a breakdown by medium. `activeView`
// lets the cards act as quick filters (click to filter the list).
export function InquiryMetrics({
  activeView,
  onSelect,
}: {
  activeView: string;
  onSelect: (view: string) => void;
}) {
  const { data, isPending } = useInquiryMetrics();

  const cards = [
    { view: "open", label: "Open", value: data?.open, icon: InboxIcon, tone: "amber" },
    { view: "quoted", label: "Quoted", value: data?.quoted, icon: FileTextIcon, tone: "green" },
    { view: "closed", label: "Closed", value: data?.closed, icon: XCircleIcon, tone: "gray" },
    { view: "all", label: "Total", value: data?.total, icon: LayersIcon, tone: "blue" },
  ] as const;

  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cards.map((c) => (
          <button
            key={c.view}
            type="button"
            onClick={() => onSelect(c.view)}
            className={cn(
              "rounded-xl border bg-card p-4 text-left transition hover:border-primary",
              activeView === c.view && "border-primary ring-1 ring-primary"
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {c.label}
              </span>
              <c.icon className="size-4 text-muted-foreground" />
            </div>
            <p className="mt-1 text-2xl font-bold tabular-nums">
              {isPending ? "—" : (c.value ?? 0)}
            </p>
          </button>
        ))}
      </div>

      {data && data.byMedium.length > 0 && (
        <Card className="py-0">
          <CardContent className="flex flex-wrap items-center gap-2 py-3">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              By medium
            </span>
            {data.byMedium.map((m) => (
              <span key={m.medium} className="flex items-center gap-1.5">
                <ColorBadge
                  tone="auto"
                  label={`${MEDIUM_LABELS[m.medium] ?? m.medium}: ${m.count}`}
                />
              </span>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
