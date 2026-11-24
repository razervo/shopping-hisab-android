import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, CalendarDays, ClipboardList, History, PlayCircle, ReceiptText, ShoppingBag, Sparkles } from "lucide-react";
import { RecentRecords } from "@/components/dashboard/RecentRecords";
import { useOverview } from "@/components/dashboard/useOverview";
import { inr } from "@/lib/format";

export const Route = createFileRoute("/_authed/")({
  head: () => ({ meta: [{ title: "Home · Shopping Hisab" }] }),
  component: HomePage,
});

const formatTripDate = (value) => value
  ? new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
  : "Date not set";

const formatPaise = (value) => new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
}).format(Number(value || 0) / 100);

function HomePage() {
  const { loading, overview } = useOverview();
  const [activeTrips, setActiveTrips] = useState([]);

  useEffect(() => {
    let current = true;
    fetch("/api/shopping/sessions?status=open", {
      credentials: "include",
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) return { sessions: [] };
        return response.json().catch(() => ({ sessions: [] }));
      })
      .then((result) => {
        if (current) setActiveTrips(Array.isArray(result.sessions) ? result.sessions.slice(0, 2) : []);
      })
      .catch(() => {
        if (current) setActiveTrips([]);
      });
    return () => { current = false; };
  }, []);

  return (
    <div className="pb-4">
      <section className="mb-5 px-1">
        <p className="micro text-primary">SHOPPING HISAB</p>
        <h1 className="mt-2 text-[25px] font-extrabold leading-tight tracking-tight">
          Ready for your next shop?
        </h1>
        <p className="mt-1.5 max-w-[36ch] text-[13px] leading-relaxed text-muted-foreground">
          Plan your list, keep track as you shop, and check every bill.
        </p>
      </section>

      {activeTrips.length > 0 ? (
        <section className="mb-5">
          <div className="mb-2 px-1">
            <h2 className="text-[14px] font-extrabold">Continue shopping</h2>
            <p className="mt-0.5 text-[12px] text-muted-foreground">Your unfinished trip is saved.</p>
          </div>
          <div className="space-y-2">
            {activeTrips.map((trip) => (
              <Link
                key={trip.id}
                to="/sessions/$sessionId"
                params={{ sessionId: trip.id }}
                className="flex items-center gap-3 rounded-[20px] border border-primary/15 bg-accent/35 p-3.5 transition-colors hover:bg-accent/70"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-primary">
                  <PlayCircle className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-extrabold">{trip.name || "Shopping trip"}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1"><CalendarDays className="h-3 w-3" />{formatTripDate(trip.shopping_date)}</span>
                    <span>·</span>
                    <span>{Number(trip.item_count || 0)} items</span>
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-[12px] font-extrabold tabular-nums">{formatPaise(trip.actual_total_paise)}</span>
                  <span className="mt-1 block text-[10px] font-bold text-primary">Resume →</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="animate-fade-up overflow-hidden rounded-[26px] bg-primary px-5 py-5 text-primary-foreground shadow-[0_18px_40px_-28px_rgba(11,60,40,0.9)]">
        <div className="flex items-center gap-2 text-white/70">
          <Sparkles className="h-4 w-4" />
          <p className="micro">NEW SHOPPING TRIP</p>
        </div>
        <h2 className="mt-3 text-[21px] font-extrabold leading-tight">Build your shopping list</h2>
        <p className="mt-1.5 max-w-[34ch] text-[12.5px] leading-relaxed text-white/75">
          Start with a list, estimate your cost, and carry it with you in shopping mode.
        </p>
        <Link
          to="/sessions"
          className="mt-4 flex min-h-12 items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-[14px] font-extrabold text-primary transition-transform active:scale-[0.99]"
        >
          <ShoppingBag className="h-[18px] w-[18px]" />
          Start a shopping trip
          <ArrowRight className="h-4 w-4" />
        </Link>
      </section>

      <section className="mt-5">
        <div className="mb-2 px-1">
          <h2 className="text-[14px] font-extrabold">Quick actions</h2>
          <p className="mt-0.5 text-[12px] text-muted-foreground">Jump straight to what you need.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Link
            to="/add/manual"
            className="flex min-h-[116px] flex-col items-start justify-between rounded-[20px] border border-border bg-white p-3.5 transition-colors hover:bg-secondary/40 active:scale-[0.99]"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-foreground">
              <ClipboardList className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-[13px] font-extrabold">Add a purchase</span>
              <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">Enter a purchase manually</span>
            </span>
          </Link>
          <Link
            to="/history"
            className="flex min-h-[116px] flex-col items-start justify-between rounded-[20px] border border-border bg-white p-3.5 transition-colors hover:bg-secondary/40 active:scale-[0.99]"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-foreground">
              <History className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-[13px] font-extrabold">Shopping history</span>
              <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">Browse past trips and bills</span>
            </span>
          </Link>
        </div>
      </section>

      {loading ? (
        <div className="mt-5 h-[88px] animate-pulse rounded-[22px] bg-muted" />
      ) : overview ? (
        <section className="mt-5 rounded-[22px] border border-border bg-white px-4 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
              <ReceiptText className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-semibold text-muted-foreground">Spent this month</p>
              <p className="tnum mt-0.5 text-[22px] font-extrabold">{inr(overview.monthTotal)}</p>
            </div>
            <Link to="/history" className="inline-flex shrink-0 items-center gap-1 text-[12px] font-bold text-primary">
              Details <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </section>
      ) : null}

      {overview ? <RecentRecords records={overview.recent} /> : null}
    </div>
  );
}
