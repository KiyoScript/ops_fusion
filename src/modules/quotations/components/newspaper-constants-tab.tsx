"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RotateCcwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DEFAULT_FORMULA_PARAMS,
  type FormulaParams,
} from "@/modules/quotations/services/newspaper-formula";
import { updateNewspaperFormulaParamsAction } from "@/app/(app)/maintenance/newspaper/actions";

const numF = (v: string) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const DEFAULT_CONSTS = {
  pricePerPlate: String(DEFAULT_FORMULA_PARAMS.pricePerPlate),
  laborPerPlate: String(DEFAULT_FORMULA_PARAMS.laborPerPlate),
  paperRate: String(DEFAULT_FORMULA_PARAMS.paperRate),
  runningRate: String(DEFAULT_FORMULA_PARAMS.runningRate),
  marginPct: String(DEFAULT_FORMULA_PARAMS.marginPct * 100),
};
const constsFrom = (p: FormulaParams) => ({
  pricePerPlate: String(p.pricePerPlate),
  laborPerPlate: String(p.laborPerPlate),
  paperRate: String(p.paperRate),
  runningRate: String(p.runningRate),
  marginPct: String(p.marginPct * 100),
});

export function NewspaperConstantsTab({ params }: { params: FormulaParams }) {
  const router = useRouter();
  const savedConsts = constsFrom(params);
  const [consts, setConsts] = useState(savedConsts);
  const [saving, setSaving] = useState(false);
  const setConst = (k: keyof typeof consts, v: string) =>
    setConsts((s) => ({ ...s, [k]: v }));
  const keys = Object.keys(DEFAULT_CONSTS) as (keyof typeof DEFAULT_CONSTS)[];
  const areDefault = keys.every((k) => consts[k] === DEFAULT_CONSTS[k]);
  const dirty = keys.some((k) => consts[k] !== savedConsts[k]);

  const save = async () => {
    setSaving(true);
    const res = await updateNewspaperFormulaParamsAction({
      pricePerPlate: numF(consts.pricePerPlate),
      laborPerPlate: numF(consts.laborPerPlate),
      paperRate: numF(consts.paperRate),
      runningRate: numF(consts.runningRate),
      marginPct: numF(consts.marginPct) / 100,
    });
    setSaving(false);
    if (!res.ok) return void toast.error(res.error);
    toast.success("Formula constants saved.");
    router.refresh();
  };

  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle>Formula constants</CardTitle>
        <p className="text-sm text-muted-foreground">
          Admin-set values that build the <strong>formula estimate</strong> for a
          size that isn&apos;t in a price table yet. Plates ={" "}
          <code>color×2 + BW÷2</code>; total = plate + labor + running (per plate)
          + paper (copies×pages) + margin. Existing table prices are{" "}
          <strong>never</strong> affected.
        </p>
      </CardHeader>
      <CardContent className="grid gap-3">
        <fieldset className="grid gap-3 rounded-lg border border-rose-200 bg-rose-50/40 p-3 dark:border-rose-900/60 dark:bg-rose-950/20">
          <legend className="flex items-center gap-2 px-1 text-xs font-semibold text-rose-800 dark:text-rose-300">
            Admin constants
            <button
              type="button"
              onClick={() => setConsts(DEFAULT_CONSTS)}
              disabled={areDefault}
              className="inline-flex items-center gap-1 rounded px-1 font-normal text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
              <RotateCcwIcon className="size-3" /> defaults
            </button>
          </legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <ConstField label="Price / plate (₱)" value={consts.pricePerPlate} onChange={(v) => setConst("pricePerPlate", v)} />
            <ConstField label="Labor / plate (₱)" value={consts.laborPerPlate} onChange={(v) => setConst("laborPerPlate", v)} />
            <ConstField label="Paper / sheet (₱)" value={consts.paperRate} onChange={(v) => setConst("paperRate", v)} />
            <ConstField label="Running / plate (₱)" value={consts.runningRate} onChange={(v) => setConst("runningRate", v)} />
            <ConstField label="Margin (%)" value={consts.marginPct} onChange={(v) => setConst("marginPct", v)} />
          </div>
        </fieldset>
        <Button
          className="w-fit"
          onClick={save}
          disabled={!dirty || saving}
        >
          {saving ? "Saving…" : dirty ? "Save constants" : "Saved"}
        </Button>
      </CardContent>
    </Card>
  );
}

function ConstField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs text-rose-800 dark:text-rose-300">{label}</Label>
      <Input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-background tabular-nums"
      />
    </div>
  );
}
