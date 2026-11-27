import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CalendarDays, Download, FileSpreadsheet, FileText, Loader2, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { useReport } from "@/components/reports/useReport";
import { ddmmyyyy, inr, toISO } from "@/lib/format";
import { exportRecordsCSV, exportRecordsPDF } from "@/lib/export";
import { fetchAllRecords } from "@/lib/records";

const currentMonthKey = () => toISO(new Date()).slice(0, 7);

export const Route = createFileRoute("/_authed/reports")({
  head: () => ({ meta: [{ title: "Reports · Shopping Hisab" }] }),
  component: ReportsPage,
});

function ReportsPage() {
  const [monthKey, setMonthKey] = useState(currentMonthKey);
  const { loading, month, lifetime } = useReport(monthKey);
  const [backingUp, setBackingUp] = useState(false);

  const monthLabel = new Date(`${monthKey}-01T00:00:00`).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });

  const backup = async () => {
    setBackingUp(true);
    try {
      const records = await fetchAllRecords();
      if (!records.length) {
        toast.error("There is nothing to back up yet.");
      } else {
        exportRecordsCSV(records, "shopping-hisab-export");
        toast.success("Export downloaded");
      }
    } catch {
      toast.error("Could not create the backup. Please try again.");
    } finally {
      setBackingUp(false);
    }
  };

  const maxDaily = month ? Math.max(...month.daily.map((d) => d.total), 1) : 1;
  const spendingDays = month ? month.daily.filter((d) => d.total > 0) : [];

  return (
    <div className="pb-2">
      <h1 className="text-[24px] font-extrabold leading-tight tracking-tight">Spending summary</h1>
      <p className="mt-1 text-[13.5px] text-muted-foreground">A simple look at where your shopping went.</p>

      <label className="mt-4 block">
        <span className="micro mb-1.5 flex items-center gap-1.5 text-muted-foreground"><CalendarDays className="h-3.5 w-3.5" /> Month</span>
        <input
          type="month"
          value={monthKey}
          onChange={(e) => setMonthKey(e.target.value || currentMonthKey())}
          className="h-12 w-full rounded-xl border-[1.5px] border-[#3B0A0A] bg-white px-3 text-[14px] font-semibold shadow-[0_2px_8px_rgba(15,23,42,0.04)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>

      {loading ? (
        <div className="mt-4 animate-pulse space-y-4">
          <div className="h-[150px] rounded-[28px] bg-muted" />
          <div className="h-24 rounded-[24px] bg-muted" />
          <div className="h-52 rounded-[24px] bg-muted" />
        </div>
      ) : !month ? (
        <p className="mt-4 rounded-2xl bg-destructive/10 px-4 py-3 text-[13px] font-semibold text-destructive">
          Could not load the report. Please refresh and try again.
        </p>
      ) : (
        <>
          <section className="mt-4 rounded-[24px] bg-primary px-5 py-5 text-primary-foreground shadow-[0_10px_28px_-18px_rgba(11,60,40,0.55)]">
            <p className="micro text-[#FED7AA]">{monthLabel}</p>
            <p className="tnum mt-2 text-[36px] font-extrabold leading-none">{inr(month.total)}</p>
            <div className="mt-4 grid grid-cols-3 gap-2.5 border-t border-white/15 pt-3 text-[12px]">
              <div className="rounded-xl bg-white/10 px-2.5 py-2">
                <span className="block text-white/65">Purchases</span>
                <span className="tnum mt-1 block text-[15px] font-bold">{month.entries}</span>
              </div>
              <div className="rounded-xl bg-white/10 px-2.5 py-2">
                <span className="block text-white/65">Daily average</span>
                <span className="tnum mt-1 block text-[15px] font-bold">{inr(Math.round(month.avgPerDay))}</span>
              </div>
              <div className="rounded-xl bg-white/10 px-2.5 py-2">
                <span className="block text-white/65">Highest day</span>
                <span className="tnum mt-1 block text-[15px] font-bold">
                  {month.highestDay ? inr(month.highestDay.total) : inr(0)}
                </span>
              </div>
            </div>
          </section>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-[18px] border-[1.5px] border-[#3B0A0A] bg-white p-3.5 shadow-[0_2px_8px_rgba(15,23,42,0.04)]">
              <p className="micro text-muted-foreground">Total spent</p>
              <p className="tnum mt-1.5 text-[20px] font-extrabold leading-none">{inr(lifetime?.total || 0)}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {lifetime?.entries || 0} {(lifetime?.entries || 0) === 1 ? "purchase" : "purchases"}, all time
              </p>
            </div>
            <div className="rounded-[18px] border-[1.5px] border-[#3B0A0A] bg-white p-4 shadow-[0_2px_8px_rgba(15,23,42,0.04)]">
              <p className="micro text-muted-foreground">Biggest purchase</p>
              <p className="tnum mt-1.5 text-[20px] font-extrabold leading-none">{inr(lifetime?.highest || 0)}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">Single highest bill</p>
            </div>
          </div>

          <section className="mt-4 rounded-[18px] border-[1.5px] border-[#3B0A0A] bg-white p-4 shadow-[0_4px_14px_rgba(15,23,42,0.05)]">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[13px] font-bold tracking-wide">Daily totals</h2>
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
                <TrendingUp className="h-3.5 w-3.5" /> {spendingDays.length}{" "}
                {spendingDays.length === 1 ? "day" : "days"}
              </span>
            </div>

            {spendingDays.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-muted-foreground">
                No purchases yet in {monthLabel}.
              </p>
            ) : (
              <ul className="space-y-2.5">
                {spendingDays.map((d) => (
                  <li key={d.iso} className="grid grid-cols-[52px_1fr_auto] items-center gap-3">
                    <span className="tnum text-[12px] font-semibold text-muted-foreground">
                      {ddmmyyyy(d.iso).slice(0, 5)}
                    </span>
                    <span className="h-2 overflow-hidden rounded-full bg-secondary">
                      <span
                        className="block h-full rounded-full bg-[#EA580C]"
                        style={{ width: `${Math.max((d.total / maxDaily) * 100, 4)}%` }}
                      />
                    </span>
                    <span className="tnum w-20 text-right text-[13px] font-bold">{inr(d.total)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="mt-4 space-y-2.5 rounded-[18px] border-[1.5px] border-[#3B0A0A] bg-white p-3 shadow-[0_4px_14px_rgba(15,23,42,0.05)]">
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => {
                  if (!month.records.length) return toast.error("Nothing to export for this month.");
                  exportRecordsCSV(month.records, `shopping-hisab-${monthKey}`);
                  toast.success("CSV exported");
                }}
                className="flex items-center justify-center gap-2 rounded-full border-[1.5px] border-[#3B0A0A] bg-white py-3.5 text-[13px] font-bold"
              >
                <FileSpreadsheet className="h-4 w-4" /> Export CSV
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!month.records.length) return toast.error("Nothing to export for this month.");
                  await exportRecordsPDF(month.records, `shopping-hisab-${monthKey}`);
                }}
                className="flex items-center justify-center gap-2 rounded-full border-[1.5px] border-[#3B0A0A] bg-white py-3 text-[13px] font-bold"
              >
                <FileText className="h-4 w-4" /> Export PDF
              </button>
            </div>

            <button
              type="button"
              onClick={backup}
              disabled={backingUp}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-[#0F766E] py-3.5 text-[13px] font-bold text-white disabled:opacity-60"
            >
              {backingUp ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {backingUp ? "Preparing backup…" : "Backup my shopping (CSV)"}
            </button>
            <p className="px-2 text-center text-[11.5px] leading-relaxed text-muted-foreground">
              Your export includes shopping totals, item details and receipt information. Receipt files remain in your private Google Drive.
            </p>
          </section>
        </>
      )}
    </div>
  );
}