"use client";

import { useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useCustomerSearch } from "@/modules/shared/hooks/use-customer-search";
import type { CustomerSuggestion } from "@/modules/shared/repositories/customer-repository";

/**
 * Free-text customer field with debounced suggestions from the customer
 * master. Typing a brand-new name is allowed — the service quick-creates the
 * customer on save (no separate Customers page needed yet).
 *
 * Keyboard: ↑/↓ move through suggestions, Enter picks the highlighted one
 * (only while the list is open — otherwise the form's default applies),
 * Escape dismisses the list until the text changes again.
 */
export function CustomerCombobox({
  value,
  onChange,
  onPick,
  invalid,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Fired when an EXISTING customer is picked — carries the full record so
   *  the caller can auto-fill contact/email/company. */
  onPick?: (customer: CustomerSuggestion) => void;
  invalid?: boolean;
  id?: string;
}) {
  const listId = useId();
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const search = useCustomerSearch(value);
  const options = (search.data ?? []).filter(
    (o) => o.name.toLowerCase() !== value.trim().toLowerCase()
  );
  const open =
    focused && !dismissed && value.trim().length >= 2 && options.length > 0;

  const pick = (option: CustomerSuggestion) => {
    onChange(option.name);
    onPick?.(option);
    setFocused(false);
    setActiveIndex(-1);
  };

  const handleInput = (next: string) => {
    onChange(next);
    setDismissed(false); // new text re-opens a dismissed list
    setActiveIndex(-1); // stale highlight never survives a text change
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % options.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? options.length - 1 : i - 1));
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault(); // don't submit the form when picking
      pick(options[activeIndex]!);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setDismissed(true);
      setActiveIndex(-1);
    }
  };

  return (
    <div className="relative">
      <Input
        id={id}
        value={value}
        onChange={(e) => handleInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="Type a customer name…"
        autoComplete="off"
        aria-invalid={invalid}
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={
          open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined
        }
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-40 mt-1 max-h-56 w-full overflow-y-auto rounded-lg bg-popover p-1 text-sm shadow-md ring-1 ring-foreground/10"
        >
          {options.map((option, index) => {
            const detail = [option.company, option.contactNumber]
              .filter(Boolean)
              .join(" · ");
            return (
              <li
                key={option.id}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === activeIndex}
              >
                <button
                  type="button"
                  tabIndex={-1}
                  className={cn(
                    "w-full rounded-md px-2 py-1.5 text-left",
                    index === activeIndex
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent hover:text-accent-foreground"
                  )}
                  onMouseEnter={() => setActiveIndex(index)}
                  // onMouseDown so it fires before the input's blur
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(option);
                  }}
                >
                  <span className="block wrap-break-word">{option.name}</span>
                  {detail && (
                    <span className="block text-xs text-muted-foreground wrap-break-word">
                      {detail}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
