"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TriangleAlertIcon } from "lucide-react";
import { useDebounce } from "@/modules/shared/hooks/use-debounce";
import { checkDuplicateNameAction } from "@/app/(app)/customers/actions";
import { composePersonName } from "../person-name";
import type { DuplicateNameMatch } from "../schemas/customer";

// Soft duplicate warning (non-blocking): as the Last/First/MI fields fill in, it
// checks for existing customers with the same composed name and surfaces them so
// staff notice a returning customer instead of creating a redundant record. The
// user can still save — real people share names.
export function DuplicateNameWarning({
  firstName,
  lastName,
  middleInitial,
  excludeId,
}: {
  firstName: string;
  lastName: string;
  middleInitial?: string;
  /** Exclude this customer id (the one being edited) from the matches. */
  excludeId?: string;
}) {
  const dFirst = useDebounce(firstName.trim());
  const dLast = useDebounce(lastName.trim());
  const dMi = useDebounce((middleInitial ?? "").trim());
  const [matches, setMatches] = useState<DuplicateNameMatch[]>([]);

  useEffect(() => {
    let cancelled = false;
    // Not-ready resolves to [] through the same async path, so setState is only
    // ever called inside a callback (never synchronously in the effect body).
    const pending =
      dFirst && dLast
        ? checkDuplicateNameAction({
            firstName: dFirst,
            lastName: dLast,
            middleInitial: dMi,
            excludeId,
          })
        : Promise.resolve({ ok: true as const, data: [] as DuplicateNameMatch[] });
    pending.then((res) => {
      if (!cancelled) setMatches(res.ok ? res.data : []);
    });
    return () => {
      cancelled = true;
    };
  }, [dFirst, dLast, dMi, excludeId]);

  if (matches.length === 0) return null;
  const composed = composePersonName({
    firstName: dFirst,
    lastName: dLast,
    middleInitial: dMi,
  });

  return (
    <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
      <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
      <div className="grid gap-1">
        <p className="font-medium">
          Possible duplicate — “{composed}” already exists
        </p>
        <ul className="grid gap-0.5">
          {matches.map((m) => (
            <li key={m.id}>
              <Link
                href={`/customers/${m.id}`}
                target="_blank"
                className="font-medium underline underline-offset-2"
              >
                {m.name}
              </Link>{" "}
              — {m.companyId ? `${m.company ?? "company"} contact` : "individual"}
              {m.status === "INACTIVE" ? " (inactive)" : ""}
            </li>
          ))}
        </ul>
        <p className="text-xs opacity-80">
          You can still save if this is a different person.
        </p>
      </div>
    </div>
  );
}
