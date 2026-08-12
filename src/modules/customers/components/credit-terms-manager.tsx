"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  createCreditTermAction,
  deleteCreditTermAction,
  toggleCreditTermAction,
} from "@/app/(app)/maintenance/customers/actions";

type Term = { id: string; days: number; isActive: boolean };

export function CreditTermsManager({ terms }: { terms: Term[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [days, setDays] = useState("");

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) { toast.error(res.error ?? "Something went wrong."); return; }
      toast.success(okMsg);
      router.refresh();
    });

  const add = () => {
    const n = Number(days);
    if (!Number.isInteger(n) || n < 1) { toast.error("Enter a whole number of days."); return; }
    run(() => createCreditTermAction(n).then((r) => ({ ok: r.ok, error: r.ok ? undefined : r.error })), `${n}-day terms added.`);
    setDays("");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Credit terms</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <p className="text-sm text-muted-foreground">
          The net-days options offered on the customer / company credit-terms
          dropdown. Deactivate to hide an option without deleting history.
        </p>
        <div className="flex items-end gap-2">
          <div className="grid gap-1">
            <Label htmlFor="ct-days" className="text-xs">Days</Label>
            <Input
              id="ct-days"
              inputMode="numeric"
              value={days}
              onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))}
              placeholder="e.g. 45"
              className="h-9 w-28"
              onKeyDown={(e) => { if (e.key === "Enter") add(); }}
            />
          </div>
          <Button variant="outline" size="sm" onClick={add} disabled={pending || !days}>
            <PlusIcon /> Add
          </Button>
        </div>

        {terms.length === 0 ? (
          <p className="text-sm text-muted-foreground">No credit terms yet.</p>
        ) : (
          <ul className="grid gap-1.5">
            {terms.map((t) => (
              <li key={t.id} className="flex items-center gap-3 rounded-lg border p-2.5 text-sm">
                <span className="font-medium tabular-nums">{t.days} days</span>
                <div className="ml-auto flex items-center gap-2">
                  <Switch
                    checked={t.isActive}
                    onCheckedChange={(v) =>
                      run(() => toggleCreditTermAction({ id: t.id, isActive: v }), v ? "Activated." : "Deactivated.")
                    }
                    disabled={pending}
                    aria-label={`Toggle ${t.days}-day terms`}
                  />
                  <span className="w-16 text-xs text-muted-foreground">{t.isActive ? "Active" : "Inactive"}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => run(() => deleteCreditTermAction(t.id), "Deleted.")}
                    disabled={pending}
                    aria-label={`Delete ${t.days}-day terms`}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
