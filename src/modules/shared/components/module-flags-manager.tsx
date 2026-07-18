"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { setModuleEnabledAction } from "@/app/(app)/settings/actions";
import type { ModuleFlagDto } from "@/modules/shared/services/module-flag-service";

const GROUP_ORDER = ["Sales", "Operations", "Masters"] as const;

/** Flipper-style feature toggles: enable only the modules a demo should show;
 *  the rest disappear from the sidebar and their routes are blocked. */
export function ModuleFlagsManager({ modules }: { modules: ModuleFlagDto[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Optimistic local state so the switch flips instantly; reconciled on save.
  const [state, setState] = useState<Record<string, boolean>>(
    () => Object.fromEntries(modules.map((m) => [m.key, m.enabled]))
  );

  const enabledCount = Object.values(state).filter(Boolean).length;

  const toggle = (key: string, label: string, next: boolean) => {
    const prev = state[key] ?? false;
    setState((s) => ({ ...s, [key]: next }));
    startTransition(async () => {
      const result = await setModuleEnabledAction({ key, enabled: next });
      if (!result.ok) {
        setState((s) => ({ ...s, [key]: prev })); // roll back
        toast.error(result.error);
        return;
      }
      toast.success(`${label} ${next ? "enabled" : "disabled"}.`);
      router.refresh();
    });
  };

  const byGroup = GROUP_ORDER.map((group) => ({
    group,
    items: modules.filter((m) => m.group === group),
  })).filter((g) => g.items.length > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Modules
          <Badge variant="secondary">
            {enabledCount}/{modules.length} on
          </Badge>
        </CardTitle>
        <CardDescription>
          Turn modules on or off for a demo. A disabled module vanishes from the
          sidebar and its pages redirect — nothing is deleted, flip it back
          anytime. Dashboard and Settings always stay available.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        {byGroup.map(({ group, items }) => (
          <div key={group} className="grid gap-2">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {group}
            </p>
            <ul className="grid gap-1">
              {items.map((m) => {
                const on = state[m.key] ?? false;
                return (
                  <li
                    key={m.key}
                    className="flex items-center justify-between gap-4 rounded-lg border px-3 py-2.5"
                  >
                    <div className="grid gap-0.5">
                      <span className="flex items-center gap-2 text-sm font-medium">
                        {m.label}
                        {!on && (
                          <Badge variant="ghost" className="text-muted-foreground">
                            Hidden
                          </Badge>
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground wrap-break-word">
                        {m.description}
                      </span>
                    </div>
                    <Switch
                      checked={on}
                      disabled={pending}
                      onCheckedChange={(next) => toggle(m.key, m.label, next)}
                      aria-label={`${m.label} module`}
                    />
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
