import { Loader2, Sparkles } from "lucide-react";

export function EstimateBar({ busy, message, estimatedCount, hasItems, onEstimate, onClear }) {
  return (
    <section className="rounded-[22px] border border-dashed border-primary/30 bg-accent/40 px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12.5px] font-bold">Shopping list estimate</p>
          <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
            Get a rough market-price total before shopping. At the shop, upload the same list with
            actual prices written beside the items, or enter the prices manually.
          </p>
        </div>
        <button
          type="button"
          onClick={onEstimate}
          disabled={busy || !hasItems}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-3.5 py-2 text-[11.5px] font-bold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {busy ? "Checking…" : "Estimate"}
        </button>
      </div>

      {message ? (
        <p className="mt-2 text-[11.5px] font-semibold leading-snug text-primary">{message}</p>
      ) : null}

      {hasItems ? (
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium text-muted-foreground">
            {estimatedCount > 0
              ? `${estimatedCount} ${estimatedCount === 1 ? "item" : "items"} at market price`
              : "List kept on this phone until you save"}
          </span>
          <button
            type="button"
            onClick={onClear}
            className="shrink-0 text-[11px] font-bold text-muted-foreground underline decoration-dotted underline-offset-2 transition-colors hover:text-destructive"
          >
            Clear list
          </button>
        </div>
      ) : null}
    </section>
  );
}