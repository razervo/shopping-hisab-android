import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, CalendarDays, History, PlayCircle, ReceiptText, ShoppingBag } from "lucide-react";
import { RecentRecords } from "@/components/dashboard/RecentRecords";
import { useOverview } from "@/components/dashboard/useOverview";
import { inr, inrPaise } from "@/lib/format";

export const Route = createFileRoute("/_authed/")({
  head: () => ({ meta: [{ title: "Home · Shopping Hisab" }] }),
  component: HomePage,
});

const formatTripDate = (value) => value
  ? new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
  : "Date not set";

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
    <div className="min-h-full bg-[#F6F8F7] pb-28">
      <section className="mb-5 rounded-[18px] border-[1.5px] border-[#450A0A] bg-white p-5 shadow-[0_4px_14px_rgba(15,23,42,0.05)]">
        <p className="micro inline-flex rounded-full bg-[#0F766E]/10 px-2.5 py-1 text-[#0F766E]">YOUR SHOPPING COMPANION</p>
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
                className="flex min-h-[76px] items-center gap-3 rounded-[18px] border-[1.5px] border-[#3B0A0A] bg-[#FFF7ED] p-3.5 transition-colors hover:bg-[#F6F8F7]"
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
                  <span className="block text-[12px] font-extrabold tabular-nums">{inrPaise(trip.actual_total_paise)}</span>
                  <span className="mt-1 block text-[10px] font-bold text-primary">Continue <ArrowRight className="inline h-3 w-3" /></span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="mt-1">
        <div className="mb-2 px-1">
          <h2 className="text-[14px] font-extrabold">Choose what you need</h2>
          <p className="mt-0.5 text-[12px] text-muted-foreground">Start a planned trip or record shopping already completed.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Link
            to="/sessions"
            className="flex min-h-[150px] flex-col items-start justify-between rounded-[22px] border-[1.5px] border-[#450A0A] bg-white p-4 shadow-[0_2px_12px_rgba(15,23,42,0.04)] transition-all hover:bg-[#F6F8F7] active:scale-[0.99]"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0F766E]/10 text-[#0F766E]">
              <ShoppingBag className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-[13px] font-extrabold">Plan a Shopping Trip</span>
              <span className="mt-1 block text-[11px] leading-snug text-muted-foreground">Build a list, estimate and track bills.</span>
            </span>
            <ArrowRight className="h-4 w-4 text-[#0F766E]" />
          </Link>
          <Link
            to="/add/manual"
            className="flex min-h-[150px] flex-col items-start justify-between rounded-[22px] border-[1.5px] border-[#450A0A] bg-white p-4 shadow-[0_2px_12px_rgba(15,23,42,0.04)] transition-all hover:bg-[#F6F8F7] active:scale-[0.99]"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#EA580C]/10 text-[#EA580C]">
              <ReceiptText className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-[13px] font-extrabold">Log Past Purchase</span>
              <span className="mt-1 block text-[11px] leading-snug text-muted-foreground">Quickly save what you already bought.</span>
            </span>
            <ArrowRight className="h-4 w-4 text-[#EA580C]" />
          </Link>
        </div>
      </section>

      {loading ? (
        <div className="mt-5 h-[88px] animate-pulse rounded-[22px] bg-muted" />
      ) : overview ? (
        <section className="mt-5 flex items-center gap-3 rounded-[18px] border-[1.5px] border-[#3B0A0A] bg-white px-4 py-4 shadow-[0_2px_12px_rgba(15,23,42,0.04)]">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#0F766E]/10 text-[#0F766E]">
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
