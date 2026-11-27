import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, CalendarDays, History, PlayCircle, ReceiptText, ShoppingBag, Sparkles } from "lucide-react";
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
    <div className="pb-6">
      <section className="mb-5 rounded-[24px] border border-emerald-100 bg-white p-5 shadow-[0_2px_12px_rgba(15,23,42,0.04)]">
        <p className="micro inline-flex rounded-full bg-primary/10 px-2.5 py-1 text-primary">YOUR SHOPPING COMPANION</p>
        <h1 className="mt-2 max-w-[19ch] text-[28px] font-extrabold leading-[1.12] tracking-tight">
          What are we shopping for today?
        </h1>
        <p className="mt-2 max-w-[34ch] text-[13px] leading-[1.65] text-muted-foreground">
          Make your list, plan a budget and keep track of what you spend—all in one place.
        </p>
      </section>

      {activeTrips.length > 0 ? (
        <section className="mb-5">
          <div className="mb-2 px-1">
            <h2 className="text-[14px] font-extrabold">Pick up where you left off</h2>
            <p className="mt-0.5 text-[12px] text-muted-foreground">Your unfinished trips are ready to continue.</p>
          </div>
          <div className="space-y-2">
            {activeTrips.map((trip) => (
              <Link
                key={trip.id}
                to="/sessions/$sessionId"
                params={{ sessionId: trip.id }}
                className="flex min-h-[76px] items-center gap-3 rounded-[18px] border border-emerald-200 bg-emerald-50/80 p-3.5 transition-colors hover:bg-emerald-50"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-primary">
                  <PlayCircle className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-extrabold">{trip.name || "Shopping trip"}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1"><CalendarDays className="h-3 w-3" />{formatTripDate(trip.shopping_date)}</span>
                    <span>·</span>
                    <span>{Number(trip.item_count || 0)} {Number(trip.item_count || 0) === 1 ? "item" : "items"}</span>
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-[12px] font-extrabold tabular-nums">{formatPaise(trip.actual_total_paise)}</span>
                  <span className="mt-1 block text-[10px] font-bold text-primary">Continue <ArrowRight className="inline h-3 w-3" /></span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="animate-fade-up overflow-hidden rounded-[26px] bg-primary px-5 py-6 text-primary-foreground shadow-[0_12px_30px_-18px_rgba(11,60,40,0.55)]">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15">
          <Sparkles className="h-5 w-5" />
        </div>
        <p className="micro mt-5 text-white/65">START WITH YOUR LIST</p>
        <h2 className="mt-2 text-[21px] font-extrabold leading-tight">Plan your next shopping trip</h2>
        <p className="mt-2 max-w-[34ch] text-[12.5px] leading-relaxed text-white/75">
          List what you need, estimate the cost, then record bills as you shop.
        </p>
        <Link
          to="/sessions"
          className="mt-5 flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3 text-[14px] font-extrabold text-primary transition-transform active:scale-[0.99]"
        >
          <ShoppingBag className="h-[18px] w-[18px]" />
          Start a shopping trip
          <ArrowRight className="h-4 w-4" />
        </Link>
      </section>

      <section className="mt-5">
        <div className="mb-2 px-1">
          <h2 className="text-[14px] font-extrabold">Quick actions</h2>
          <p className="mt-0.5 text-[12px] text-muted-foreground">Jump straight into what you need.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Link
            to="/sessions"
            className="flex min-h-[124px] flex-col items-start justify-between rounded-[22px] border border-border bg-white p-4 shadow-[0_2px_12px_rgba(15,23,42,0.04)] transition-all hover:border-primary/25 hover:bg-secondary/30 active:scale-[0.99]"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-foreground">
              <ShoppingBag className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-[13px] font-extrabold">Plan a list</span>
              <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">Create a trip and add items</span>
            </span>
          </Link>
          <Link
            to="/add/manual"
            className="flex min-h-[124px] flex-col items-start justify-between rounded-[22px] border border-border bg-white p-4 shadow-[0_2px_12px_rgba(15,23,42,0.04)] transition-colors hover:bg-secondary/40 active:scale-[0.99]"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
              <ReceiptText className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-[13px] font-extrabold">Quick expense</span>
              <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">Record a purchase you made</span>
            </span>
          </Link>
          <Link
            to="/history"
            className="col-span-2 flex min-h-[68px] items-center gap-3 rounded-[22px] border border-border bg-white px-4 py-3 shadow-[0_2px_12px_rgba(15,23,42,0.04)] transition-colors hover:bg-secondary/30 active:scale-[0.99]"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-primary">
              <History className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-extrabold">My shopping history</span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">Review previous trips and purchases</span>
            </span>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        </div>
      </section>

      {loading ? (
        <div className="mt-5 h-[88px] animate-pulse rounded-[22px] bg-muted" />
      ) : overview ? (
        <section className="mt-5 flex items-center gap-3 rounded-[22px] border border-emerald-100 bg-white px-4 py-4 shadow-[0_2px_12px_rgba(15,23,42,0.04)]">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
            <ReceiptText className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-semibold text-muted-foreground">This month's snapshot</p>
            <p className="tnum mt-0.5 text-[20px] font-extrabold">{inr(overview.monthTotal)}</p>
          </div>
          <Link to="/reports" className="inline-flex shrink-0 items-center gap-1 text-[12px] font-bold text-primary">
            Summary <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </section>
      ) : null}

      {overview ? <RecentRecords records={overview.recent} /> : null}
    </div>
  );
}
