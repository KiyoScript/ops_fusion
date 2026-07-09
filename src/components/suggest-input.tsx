"use client";

import { useEffect, useRef, useState } from "react";
import { CheckIcon, ChevronDownIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

export type SuggestOption = string | { value: string; label: string };

/**
 * Searchable combo dropdown, behavior ported from the legacy JOWebApp combos
 * (statusDeptInput/jo-combo-dropdown): click or focus opens the full list,
 * typing filters it, ↑/↓ + Enter select, Escape/outside click closes, and an
 * × clears. `multiple` keeps comma-separated values (legacy multi-employee
 * assignment) — picking toggles entries in and out.
 */
export function SuggestInput({
  value,
  onChange,
  options,
  placeholder,
  id,
  invalid,
  className,
  multiple = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SuggestOption[];
  placeholder?: string;
  id?: string;
  invalid?: boolean;
  className?: string;
  multiple?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on outside click, like the legacy document-level mousedown handler.
  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  const normalized = options.map((o) =>
    typeof o === "string" ? { value: o, label: o } : o
  );

  // Multi mode: the value is "CODE1, CODE2"; the last fragment is what the
  // user is currently typing/filtering on.
  const parts = multiple
    ? value.split(",").map((p) => p.trim()).filter(Boolean)
    : [];
  const selected = new Set(parts.map((p) => p.toLowerCase()));
  const fragment = multiple
    ? typed
      ? (value.split(",").pop() ?? "").trim().toLowerCase()
      : ""
    : typed
      ? value.trim().toLowerCase()
      : "";

  const filtered = fragment
    ? normalized.filter(
        (o) =>
          o.label.toLowerCase().includes(fragment) ||
          o.value.toLowerCase().includes(fragment)
      )
    : normalized;

  const openList = () => {
    setTyped(false);
    setActiveIdx(-1);
    setOpen(true);
  };

  const select = (option: { value: string; label: string }) => {
    if (multiple) {
      const isSelected = selected.has(option.value.toLowerCase());
      // Drop the in-progress fragment, then toggle the picked entry.
      const complete = typed ? parts.slice(0, -1) : [...parts];
      const kept = complete.filter(
        (p) => p.toLowerCase() !== option.value.toLowerCase()
      );
      if (!isSelected) kept.push(option.value);
      onChange(kept.join(", "));
      setTyped(false);
      setActiveIdx(-1);
      inputRef.current?.focus();
    } else {
      onChange(option.value);
      setOpen(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) openList();
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (open && activeIdx >= 0 && filtered[activeIdx]) {
        e.preventDefault();
        select(filtered[activeIdx]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      <Input
        ref={inputRef}
        id={id}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setTyped(true);
          setActiveIdx(-1);
          setOpen(true);
        }}
        onFocus={openList}
        onClick={() => !open && openList()}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoComplete="off"
        aria-invalid={invalid}
        role="combobox"
        aria-expanded={open}
        className="pr-14"
      />
      <span className="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center">
        {value && (
          <button
            type="button"
            tabIndex={-1}
            aria-label="Clear"
            className="rounded p-0.5 text-muted-foreground hover:text-foreground"
            onMouseDown={(e) => {
              e.preventDefault();
              onChange("");
              setTyped(false);
              inputRef.current?.focus();
            }}
          >
            <XIcon className="size-3.5" />
          </button>
        )}
        <button
          type="button"
          tabIndex={-1}
          aria-label={open ? "Close options" : "Show options"}
          className="rounded p-0.5 text-muted-foreground hover:text-foreground"
          onMouseDown={(e) => {
            e.preventDefault();
            if (open) setOpen(false);
            else {
              openList();
              inputRef.current?.focus();
            }
          }}
        >
          <ChevronDownIcon
            className={cn("size-4 transition-transform", open && "rotate-180")}
          />
        </button>
      </span>

      {open && (
        <ul className="absolute z-40 mt-1 max-h-56 w-full min-w-44 overflow-y-auto rounded-lg bg-popover p-1 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10">
          {filtered.length === 0 ? (
            <li className="px-2 py-1.5 text-muted-foreground">
              No matches — free text is allowed.
            </li>
          ) : (
            filtered.map((option, index) => {
              const isSelected =
                multiple && selected.has(option.value.toLowerCase());
              return (
                <li key={option.value}>
                  <button
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground",
                      index === activeIdx && "bg-accent text-accent-foreground"
                    )}
                    // onMouseDown so it fires before the input's blur
                    onMouseDown={(e) => {
                      e.preventDefault();
                      select(option);
                    }}
                  >
                    <span className="flex-1 truncate">{option.label}</span>
                    {isSelected && <CheckIcon className="size-4 shrink-0" />}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
