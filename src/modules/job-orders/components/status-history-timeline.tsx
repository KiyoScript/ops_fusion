"use client";

import { ChevronDownIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// Legacy JOWebApp status-history timeline: one card per history line with the
// "M/d h:mm a" stamp split out, first/latest badges, and elapsed-time chips
// between consecutive entries.

type Entry = {
  date: string | null;
  time: string | null;
  text: string;
  at: Date | null;
};

const LINE_RX = /^(\d{1,2}\/\d{1,2})(?:\s+(\d{1,2}:\d{2}\s*[AP]M))?\s*(.*)$/i;

function parseLine(line: string): Entry {
  const match = line.trim().match(LINE_RX);
  if (!match) return { date: null, time: null, text: line.trim(), at: null };
  const [, date, time, text] = match;
  const at = new Date(
    `${date}/${new Date().getFullYear()} ${time ?? "12:00 AM"}`
  );
  return {
    date: date ?? null,
    time: time?.toUpperCase() ?? null,
    text: (text ?? "").trim() || "(status update)",
    at: isNaN(at.getTime()) ? null : at,
  };
}

/** "+15m" / "+2h 30m" / "+3d 4h" between two timestamps — shared by the
 *  status timeline and the production-steps checklist so gaps read the same
 *  everywhere. */
export function elapsed(from: Date, to: Date): string | null {
  const minutes = Math.round((to.getTime() - from.getTime()) / 60_000);
  if (minutes <= 0) return null; // same minute or year rollover — skip
  if (minutes < 60) return `+${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `+${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return hours % 24 > 0 ? `+${days}d ${hours % 24}h` : `+${days}d`;
}

export function StatusHistoryTimeline({ history }: { history: string | null }) {
  const entries = (history ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map(parseLine);

  return (
    // Collapsible like the legacy "Status History ▾" bar — open by default.
    <details open className="group grid gap-2">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium select-none [&::-webkit-details-marker]:hidden">
        Status History
        <Badge variant="secondary">{entries.length} entr{entries.length === 1 ? "y" : "ies"}</Badge>
        <ChevronDownIcon className="ml-auto size-4 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      {entries.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground italic">
          No status updates recorded yet.
        </p>
      ) : (
        <div className="max-h-64 overflow-y-auto pr-1">
          {entries.map((entry, index) => {
            const isFirst = index === 0;
            const isLatest = index === entries.length - 1;
            const gap =
              index > 0 && entries[index - 1]!.at && entry.at
                ? elapsed(entries[index - 1]!.at!, entry.at!)
                : null;
            return (
              <div key={index} className="grid grid-cols-[16px_1fr] gap-x-2">
                {index > 0 && (
                  <>
                    <span className="justify-self-center border-l border-border" />
                    <span className="py-1">
                      {gap && (
                        <Badge variant="ghost" className="text-[0.7rem]">
                          {gap}
                        </Badge>
                      )}
                    </span>
                  </>
                )}
                <span className="grid justify-items-center pt-3">
                  <span
                    className={cn(
                      "size-2.5 rounded-full",
                      isLatest
                        ? "bg-emerald-500"
                        : isFirst
                          ? "bg-indigo-400"
                          : "bg-sky-400"
                    )}
                  />
                </span>
                <div className="rounded-lg border bg-card px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {entry.date && <span>📅 {entry.date}</span>}
                    {entry.time && <span>🕒 {entry.time}</span>}
                    {isFirst && <Badge variant="secondary">first</Badge>}
                    {isLatest && (
                      <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
                        latest
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 whitespace-pre-wrap text-sm">{entry.text}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </details>
  );
}
