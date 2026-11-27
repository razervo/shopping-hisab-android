import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { ddmmyyyy, inr } from "@/lib/format";

export function RecentRecords({ records }) {
  return (
    <section className="mt-6">
      <div className="mb-2 flex items-baseline justify-between px-1">
        <h2 className="text-[13px] font-bold tracking-wide">Recent shopping</h2>
        <Link to="/history" className="text-[12px] font-semibold text-primary hover:underline">
          View all
        </Link>
      </div>

      {records.length === 0 ? (
        <div className="rounded-[24px] border border-dashed border-border bg-secondary/40 px-5 py-8 text-center">
          <p className="text-sm font-semibold">No shopping recorded yet</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Add your first bill to start the hisab.
          </p>
        </div>
      ) : (
        <ul className="overflow-hidden rounded-[24px] border border-border bg-white">
          {records.map((r, i) => (
            <li key={r.id}>
              <Link
                to="/record/$recordId"
                params={{ recordId: r.id }}
                className="flex items-center gap-3 px-5 py-4 transition-colors duration-200 hover:bg-secondary/60"
                style={{ borderTop: i === 0 ? "none" : "1px solid hsl(var(--border) / 0.8)" }}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14.5px] font-bold">{r.shop_name || "Shopping"}</p>
                  <p className="mt-0.5 text-[12px] text-muted-foreground">
                    {ddmmyyyy(r.date)} · {r.item_count} {r.item_count === 1 ? "item" : "items"}
                  </p>
                </div>
                <span className="tnum text-[15px] font-bold">{inr(r.total)}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}