import { useState } from "react";
import { Loader2, Sparkles, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { suggestMarketRate } from "@/lib/server-fns";
import { inr } from "@/lib/format";
import { UNIT_LABELS, UNIT_OPTIONS, amountOf, qtyOptions } from "@/lib/shopping";

export function ItemRow({ item, onChange, onRemove, canRemove, isEstimated = false, onApplyMarketRate, onConfirmActual }) {
  const line = amountOf(item);
  const fetchMarketRate = suggestMarketRate;
  const [market, setMarket] = useState(null);
  const [asking, setAsking] = useState(false);

  const unit = String(item.unit || "");
  const choices = qtyOptions(unit);
  const qtyStr = item.qty === "" || item.qty == null ? "" : String(Number(item.qty));
  const customQty = !choices.some((q) => String(q) === qtyStr);
  const units = unit && !UNIT_OPTIONS.includes(unit) ? [unit, ...UNIT_OPTIONS] : UNIT_OPTIONS;

  const askMarketRate = async () => {
    if (!unit || !String(item.name).trim() || asking) return;
    setAsking(true);
    setMarket(null);
    try {
      const res = await fetchMarketRate({ data: { name: String(item.name).trim(), unit } });
      setMarket(res?.suggestion ? { suggestion: res.suggestion } : { error: res?.error || "" });
    } catch {
      setMarket({ error: "Could not generate an estimate right now." });
    } finally {
      setAsking(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-secondary/30 p-3">
      <div className="flex items-center gap-2">
        <Input
          value={item.name}
          onChange={(e) => {
            onChange({ name: e.target.value });
            setMarket(null);
          }}
          placeholder="Item name (e.g. Rice)"
          className="h-11 flex-1 border-0 bg-white text-[15px] font-semibold shadow-none"
        />
        <button
          type="button"
          onClick={onRemove}
          disabled={!canRemove}
          aria-label="Remove item"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white hover:text-destructive disabled:opacity-30"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <div>
          <span className="micro mb-1 block text-muted-foreground">Qty</span>
          <Select
            value={customQty ? "custom" : qtyStr}
            onValueChange={(v) => onChange({ qty: v === "custom" ? "" : v })}
          >
            <SelectTrigger className="h-10 border-0 bg-white text-[14px]">
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent>
              {choices.map((q) => (
                <SelectItem key={q} value={String(q)}>
                  {q}
                </SelectItem>
              ))}
              <SelectItem value="custom">Other…</SelectItem>
            </SelectContent>
          </Select>
          {customQty ? (
            <Input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={item.qty}
              onChange={(e) => onChange({ qty: e.target.value })}
              placeholder="0"
              className="mt-2 h-10 border-0 bg-white text-[14px]"
            />
          ) : null}
        </div>
        <div>
          <span className="micro mb-1 block text-muted-foreground">Unit</span>
          <Select
            value={unit || undefined}
            onValueChange={(v) => {
              onChange({ unit: v, price: "" });
              setMarket(null);
            }}
          >
            <SelectTrigger className="h-10 border-0 bg-white text-[14px]">
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent>
              {units.map((u) => (
                <SelectItem key={u} value={u}>
                  {UNIT_LABELS[u] || u}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mt-2">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="micro text-muted-foreground">
            {isEstimated ? "Market estimate" : "Price"} · per 1 {unit || "unit"}
          </span>
          {isEstimated ? (
            <span className="shrink-0 rounded-full bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-800">
              Update with shop rate
            </span>
          ) : null}
          <button
            type="button"
            onClick={askMarketRate}
            disabled={asking || !unit || !String(item.name).trim()}
            className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold text-primary transition-colors hover:bg-accent disabled:opacity-40"
          >
            {asking ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            {asking ? "Estimating…" : "Estimate"}
          </button>
        </div>
        <Input
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={item.price}
          onChange={(e) => onChange({ price: e.target.value })}
          placeholder={isEstimated ? "Enter actual shop rate" : "Enter price for one unit"}
          aria-label={isEstimated ? `Actual shop rate per 1 ${unit || "unit"}` : `Price per 1 ${unit || "unit"}`}
          className="h-10 border-0 bg-white text-[14px]"
        />
        {isEstimated ? (
          <div className="mt-2 flex items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
            <p className="text-[11.5px] leading-snug text-amber-900">
              Change this estimate to the price you actually paid.
            </p>
            <button
              type="button"
              onClick={onConfirmActual}
              className="shrink-0 rounded-full bg-white px-3 py-1.5 text-[11px] font-bold text-amber-900 shadow-sm"
            >
              Confirm rate
            </button>
          </div>
        ) : (
          <p className="mt-1 text-[10.5px] text-muted-foreground">
            Enter the actual shop price here before saving.
          </p>
        )}
        {market?.suggestion ? (
          <div className="mt-2 flex items-center justify-between gap-2 rounded-xl bg-accent px-3 py-2">
            <p className="text-[11.5px] leading-snug">
              <span className="font-bold">
                Approx. {inr(market.suggestion.rate)} / {unit}
              </span>
              <span className="text-muted-foreground">
                {" "}
                ({inr(market.suggestion.min)}–{inr(market.suggestion.max)})
              </span>
              <span className="block text-muted-foreground">AI estimate · not a live shop price</span>
              {market.suggestion.note ? (
                <span className="block text-muted-foreground">{market.suggestion.note}</span>
              ) : null}
            </p>
            <button
              type="button"
              onClick={() => {
                if (onApplyMarketRate) onApplyMarketRate(market.suggestion.rate);
                else onChange({ price: market.suggestion.rate });
              }}
              className="shrink-0 rounded-full bg-primary px-3 py-1.5 text-[11px] font-bold text-primary-foreground"
            >
              Use
            </button>
          </div>
        ) : null}
        {market?.error ? (
          <p className="mt-2 text-[11.5px] font-semibold text-destructive">{market.error}</p>
        ) : null}
      </div>

      <div className="mt-2 flex items-center justify-between border-t border-border/70 pt-2">
        <span className="text-[11.5px] font-medium text-muted-foreground">
          {Number(item.qty) || 0} × {inr(item.price || 0)} = {inr(line)}
        </span>
        <span className="tnum text-[15px] font-bold">{inr(line)}</span>
      </div>
    </div>
  );
}