import { inr } from "@/lib/format";

function Bars({ values }) {
  const max = Math.max(...values, 1);
  return (
    <div className="flex h-24 items-end gap-[5px]">
      {values.map((v, i) => (
        <div
          key={i}
          className="flex-1 rounded-t-[3px] bg-primary/85 transition-all duration-500"
          style={{ height: `${Math.max((v / max) * 100, 3)}%`, transitionDelay: `${i * 25}ms` }}
        />
      ))}
    </div>
  );
}

function Line({ values }) {
  const w = 200;
  const h = 84;
  const pad = 8;
  const max = Math.max(...values, 1);
  const stepX = (w - pad * 2) / Math.max(values.length - 1, 1);
  const points = values.map((v, i) => [pad + i * stepX, h - pad - (v / max) * (h - pad * 2)]);
  const d = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const last = points[points.length - 1];

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-24 w-full overflow-visible" aria-hidden="true">
      {[14, 42, 70].map((y) => (
        <line key={y} x1="4" y1={y} x2="196" y2={y} stroke="hsl(var(--border))" strokeWidth="1" />
      ))}
      <path d={d} fill="none" stroke="hsl(var(--primary))" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="3.6" fill="hsl(var(--primary))" />
    </svg>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <span className="micro block text-muted-foreground">{label}</span>
      <span className="tnum mt-1 block text-[19px] font-bold leading-none">{value}</span>
    </div>
  );
}

function Card({ title, sub, children }) {
  return (
    <article className="flex flex-col gap-4 rounded-[24px] border border-border bg-white p-5">
      <header>
        <h2 className="text-[13px] font-bold tracking-wide">{title}</h2>
        <p className="mt-0.5 text-[11.5px] text-muted-foreground">{sub}</p>
      </header>
      <div className="flex-1">{children}</div>
    </article>
  );
}

export function SummaryCards({ monthTotal, entriesMonth, last7, daily14, avgPerDay }) {
  const peak = Math.max(...last7, 0);

  return (
    <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Card title="This month" sub="Daily spend">
        <Bars values={daily14} />
        <div className="mt-4 flex items-end justify-between gap-3">
          <Stat label="Total" value={inr(monthTotal)} />
          <Stat label="Entries" value={entriesMonth} />
          <Stat label="Avg / day" value={inr(Math.round(avgPerDay))} />
        </div>
      </Card>

      <Card title="Last 7 days" sub="Trend">
        <Line values={last7} />
        <div className="mt-4 flex items-end justify-between gap-3">
          <Stat label="Today" value={inr(last7[last7.length - 1])} />
          <Stat label="7-day total" value={inr(last7.reduce((a, b) => a + b, 0))} />
          <Stat label="Peak day" value={inr(peak)} />
        </div>
      </Card>
    </div>
  );
}