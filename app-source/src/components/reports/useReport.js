import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
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
        const [monthPage, lifetime] = await Promise.all([
          base44.entities.ShoppingRecord.filter({ date: { $gte: start, $lte: end } }, { sort: "-date", limit: 500 }),
          base44.entities.ShoppingRecord.aggregate({ query: {}, sum: ["total"], max: ["total"] }),
        ]);
        if (cancelled) return;

        const records = monthPage.items || [];
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
        const row = lifetime?.rows?.[0] || {};
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
            total: row.sum_total ?? 0,
            highest: row.max_total ?? 0,
            entries: row.count ?? 0,
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