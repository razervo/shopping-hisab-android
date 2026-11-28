import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, Loader2, Search } from "lucide-react";
import { base44 } from "@/api/cloudflareClient";
import { Input } from "@/components/ui/input";
import { useHistorySearch } from "@/components/history/useHistorySearch";
import { ddmmyyyy, inr } from "@/lib/format";

export const Route = createFileRoute("/_authed/history")({
  head: () => ({ meta: [{ title: "History · Shopping Hisab" }] }),
  component: HistoryPage,
});

function HistoryPage() {
  const [shop, setShop] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [applied, setApplied] = useState({ shop: "", from: "", to: "" });

  const { records, loading, error, hasMore, loadMore, loadingMore, count } = useHistorySearch(applied);

  const applyFilters = (e) => {
    e.preventDefault();
    setApplied({ shop: shop.trim(), from, to });
  };

  const reset = () => {
    setShop("");
    setFrom("");
    setTo("");
    setApplied({ shop: "", from: "", to: "" });
  };

  return (
    <div className="pb-2">
      <h1 className="text-[24px] font-extrabold leading-tight tracking-tight">Past Purchases</h1>
      <p className="mt-1 text-[13.5px] text-muted-foreground">
        Your past shopping trips and purchases, newest first.
      </p>

      <form onSubmit={applyFilters} className="mt-4 space-y-2.5 rounded-[20px] border border-border bg-white p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={shop}
            onChange={(e) => setShop(e.target.value)}
            placeholder="Search shop name"
            className="h-12 pl-10 text-[14px]"
          />
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <label className="block">
            <span className="micro mb-1 block text-muted-foreground">From</span>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-11 text-[13.5px]" />
          </label>
          <label className="block">
            <span className="micro mb-1 block text-muted-foreground">To</span>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-10 text-[13.5px]" />
          </label>
        </div>
        <div className="flex gap-2">
          <button
            type="submit"
            className="flex-1 rounded-full bg-primary py-3 text-[13.5px] font-bold text-primary-foreground"
          >
            Search
          </button>
          <button
            type="button"
            onClick={reset}
            className="rounded-full border border-border px-4 py-2.5 text-[13.5px] font-semibold text-muted-foreground"
          >
            Clear
          </button>
        </div>
      </form>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Link to="/add/manual" className="flex min-h-12 items-center justify-center rounded-full bg-primary px-3 text-[12px] font-bold text-primary-foreground">Quick log purchase</Link>
        <Link to="/add/bill" className="flex min-h-12 items-center justify-center rounded-full border border-primary/30 bg-primary/5 px-3 text-[12px] font-bold text-primary">Upload bill to verify</Link>
      </div>
      <div className="mb-2 mt-5 flex items-baseline justify-between px-1">
        <h2 className="text-[13px] font-bold tracking-wide">
          {records.length > 0
            ? `${records.length}${hasMore ? "+" : ""} ${records.length === 1 && !hasMore ? "purchase" : "purchases"}`
            : "Your purchases"}
        </h2>
        {count !== null ? (
          <span className="text-[11.5px] text-muted-foreground">Total spent {inr(count)}</span>
        ) : null}
      </div>

      {loading ? (
        <div className="space-y-2.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[74px] animate-pulse rounded-[20px] bg-muted" />
          ))}
        </div>
      ) : error ? (
        <p className="rounded-2xl bg-destructive/10 px-4 py-3 text-[13px] font-semibold text-destructive">
          Could not load your shopping history.
        </p>
      ) : records.length === 0 ? (
        <div className="rounded-[24px] border border-dashed border-border px-5 py-10 text-center">
          <p className="text-sm font-semibold">No shopping found</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {applied.shop || applied.from || applied.to
              ? "Try a different shop name or date range."
              : "Your shopping trips and saved purchases will appear here."}
          </p>
          <Link
            to="/add"
            className="mt-4 inline-block rounded-full bg-primary px-5 py-2.5 text-[13px] font-bold text-primary-foreground"
          >
            Record a past purchase
          </Link>
        </div>
      ) : (
        <ul className="overflow-hidden rounded-[20px] border border-border bg-white">
          {records.map((r, i) => (
            <li key={r.id}>
              <Link
                to="/record/$recordId"
                params={{ recordId: r.id }}
                className="flex items-center gap-3 px-3.5 py-3.5 transition-colors hover:bg-secondary/60"
                style={{ borderTop: i === 0 ? "none" : "1px solid hsl(var(--border) / 0.8)" }}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14.5px] font-bold">{r.shop_name || "Shopping"}</p>
                  <p className="mt-0.5 text-[12px] text-muted-foreground">
                    {ddmmyyyy(r.date)} · {r.item_count ?? r.items?.length ?? 0}{" "}
                    {(r.item_count ?? r.items?.length ?? 0) === 1 ? "item" : "items"}
                  </p>
                  <span className={"mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold " + (r.source === "bill" || r.reconciliation_status === "complete" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800")}>{r.source === "bill" || r.reconciliation_status === "complete" ? "Verified" : "Unverified"}</span>
                </div>
                <span className="tnum text-[15px] font-bold">{inr(r.total)}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {hasMore ? (
        <button
          type="button"
          onClick={loadMore}
          disabled={loadingMore}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-full border border-border bg-white py-3 text-[13px] font-bold"
        >
          {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      ) : null}
    </div>
  );
}