"use client";

import { useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { useCompanySearch } from "../hooks/use-company-search";
import type { CompanyPickerDto } from "../schemas/company";

/** Type-to-search company field for the add-customer flow. Picking an existing
 *  company fires onPick (with its billing) so the caller can auto-fill; typing
 *  a brand-new name is allowed (creates a new company on save). */
export function CompanyCombobox({
  value,
  onChange,
  onPick,
  invalid,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  onPick: (company: CompanyPickerDto) => void;
  invalid?: boolean;
  id?: string;
}) {
  const listId = useId();
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const search = useCompanySearch(value);
  const options = search.data ?? [];
  const open = focused && !dismissed && value.trim().length >= 2 && options.length > 0;

  return (
    <div className="relative">
      <Input
        id={id}
        value={value}
        onChange={(e) => { onChange(e.target.value); setDismissed(false); }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => { if (e.key === "Escape") setDismissed(true); }}
        placeholder="Search an existing company, or type a new one…"
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-invalid={invalid}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-40 mt-1 max-h-56 w-full overflow-y-auto rounded-lg bg-popover p-1 text-sm shadow-md ring-1 ring-foreground/10"
        >
          {options.map((c) => (
            <li key={c.id} role="option" aria-selected={false}>
              <button
                type="button"
                tabIndex={-1}
                className="w-full rounded-md px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(c.name);
                  onPick(c);
                  setFocused(false);
                }}
              >
                <span className="block font-medium wrap-break-word">{c.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {[
                    c.tin && `TIN ${c.tin}`,
                    `${c.contactCount} contact${c.contactCount === 1 ? "" : "s"}`,
                  ].filter(Boolean).join(" · ")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
