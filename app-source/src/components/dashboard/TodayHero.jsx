import { ArrowUpRight } from "lucide-react";
import { inr } from "@/lib/format";
import { useCountUp } from "@/lib/useCountUp";

export function TodayHero({ todayTotal, yesterdayTotal, monthTotal, entriesToday }) {
  const animated = useCountUp(todayTotal);
  const pct = monthTotal > 0 ? Math.min((todayTotal / monthTotal) * 100, 100) : 0;
  const animatedPct = useCountUp(pct, 1100);
  const diff = todayTotal - yesterdayTotal;
  const up = diff >= 0;

  const r = 34;
  const circumference = 2 * Math.PI * r;

  return (
    <section className="animate-fade-up overflow-hidden rounded-[30px] bg-primary px-6 py-6 text-primary-foreground shadow-[0_18px_40px_-28px_rgba(11,60,40,0.9)]">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="micro text-white/65">Today&rsquo;s shopping</p>
          <p className="tnum mt-2 text-[42px] font-extrabold leading-none">
            {inr(Math.round(animated))}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
            <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-1 font-semibold">
              {up ? "▲" : "▼"} {inr(Math.abs(diff))}
            </span>
            <span className="text-white/65">
              vs yesterday · {entriesToday} {entriesToday === 1 ? "entry" : "entries"} today
            </span>
          </div>
        </div>

        <div className="relative h-[74px] w-[74px] shrink-0" role="img" aria-label={`${Math.round(pct)} percent of this month`}>
          <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90">
            <circle cx="40" cy="40" r={r} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="6" />
            <circle
              cx="40"
              cy="40"
              r={r}
              fill="none"
              stroke="white"
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference - (circumference * animatedPct) / 100}
            />
          </svg>
          <span className="tnum absolute inset-0 flex items-center justify-center text-[13px] font-bold">
            {Math.round(animatedPct)}%
          </span>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between border-t border-white/15 pt-3 text-[12px]">
        <span className="text-white/65">Share of this month</span>
        <span className="tnum inline-flex items-center gap-1 font-semibold">
          {inr(monthTotal)} total <ArrowUpRight className="h-3.5 w-3.5" />
        </span>
      </div>
    </section>
  );
}