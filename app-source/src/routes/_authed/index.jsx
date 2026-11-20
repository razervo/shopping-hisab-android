import { createFileRoute, Link } from "@tanstack/react-router";
import { CalendarDays, Plus } from "lucide-react";
import { RecentRecords } from "@/components/dashboard/RecentRecords";
import { SummaryCards } from "@/components/dashboard/SummaryCards";
import { TodayHero } from "@/components/dashboard/TodayHero";
import { useOverview } from "@/components/dashboard/useOverview";

export const Route = createFileRoute("/_authed/")({
  head: () => ({ meta: [{ title: "Home · Shopping Hisab" }] }),
  component: HomePage,
});

function Loading() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-[196px] rounded-[30px] bg-muted" />
      <div className="h-14 rounded-full bg-muted" />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="h-56 rounded-[24px] bg-muted" />
        <div className="h-56 rounded-[24px] bg-muted" />
      </div>
    </div>
  );
}

function HomePage() {
  const { loading, overview, error } = useOverview();

  return (
    <div className="pb-2">
      <div className="mb-4">
        <p className="micro text-muted-foreground">Namaste</p>
        <h1 className="mt-1 text-[26px] font-extrabold leading-tight tracking-tight">
          Your shopping hisab
        </h1>
      </div>

      {loading ? (
        <Loading />
      ) : error ? (
        <div className="rounded-[24px] border border-border bg-secondary/40 px-5 py-8 text-center">
          <p className="text-sm font-semibold">Could not load your hisab</p>
          <p className="mt-1 text-[13px] text-muted-foreground">Please refresh the page to try again.</p>
        </div>
      ) : (
        <>
          <TodayHero
            todayTotal={overview.todayTotal}
            yesterdayTotal={overview.yesterdayTotal}
            monthTotal={overview.monthTotal}
            entriesToday={overview.entriesToday}
          />

          <Link
            to="/add"
            className="mt-4 flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-4 text-[15px] font-bold text-primary-foreground shadow-[0_14px_30px_-16px_rgba(11,60,40,0.85)] transition-transform duration-200 active:scale-[0.99]"
          >
            <Plus className="h-5 w-5" strokeWidth={2.8} />
            Add Shopping
          </Link>

          <Link
            to="/sessions"
            className="mt-2 flex items-center justify-center gap-2 rounded-full border border-border bg-white px-6 py-3.5 text-[13.5px] font-bold text-foreground transition-colors hover:bg-secondary/50"
          >
            <CalendarDays className="h-4 w-4" />
            Shopping Sessions · New workflow
          </Link>

          <SummaryCards
            monthTotal={overview.monthTotal}
            entriesMonth={overview.entriesMonth}
            last7={overview.last7}
            daily14={overview.daily14}
            avgPerDay={overview.avgPerDay}
          />

          <RecentRecords records={overview.recent} />
        </>
      )}
    </div>
  );
}