import { useEffect, useState } from "react";
import { cloudflareRequest } from "@/api/cloudflareClient";
import { monthStartISO, toISO } from "@/lib/format";

export function useReport(monthKey) {
  const [state, setState] = useState({ loading: true, month: null, lifetime: null });

  useEffect(() => {
    let cancelled = false;
    const [y, m] = (monthKey || "").split("-").map(Number);
    const base = y && m ? new Date(y, m - 1, 1) : new Date();
    const start = monthStartISO(base);
    const end = toISO(new Date(base.getFullYear(), base.getMonth() + 1, 0));
    const days = base.getDate ? new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate() : 31;

    setState((prev) => ({ ...prev, loading: true }));
    (async () => {
      try {
        const report = await cloudflareRequest(`/api/reports?month=${encodeURIComponent(monthKey)}`);
        if (cancelled) return;
        const records = report.records || [];
        const lifetime = report.lifetime || {};
        if (cancelled) return;

        const monthTotal = records.reduce((s, r) => s + (Number(r.total) || 0), 0);
        const daily = Array.from({ length: days }, (_, i) => {
          const iso = toISO(new Date(base.getFullYear(), base.getMonth(), i + 1));
          const dayRecords = records.filter((r) => r.date === iso);
          return {
            iso,
            day: i + 1,
            total: dayRecords.reduce((s, r) => s + (Number(r.total) || 0), 0),
            count: dayRecords.length,
          };
        });
        const isCurrentMonth = start.slice(0, 7) === toISO(new Date()).slice(0, 7);
        const divisor = isCurrentMonth ? Math.max(new Date().getDate(), 1) : days;

        setState({
          loading: false,
          month: {
            start,
            end,
            records,
            total: monthTotal,
            entries: records.length,
            avgPerDay: monthTotal / divisor,
            daily,
            highestDay: daily.reduce((best, d) => (d.total > (best?.total || 0) ? d : best), null),
          },
          lifetime: {
            total: Number(lifetime.total) || 0,
            highest: Number(lifetime.highest) || 0,
            entries: Number(lifetime.entries) || 0,
          },
        });
      } catch {
        if (!cancelled) setState({ loading: false, month: null, lifetime: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [monthKey]);

  return state;
}