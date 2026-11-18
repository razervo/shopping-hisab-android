import { useCallback, useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { daysAgoISO, monthStartISO, toISO, todayISO } from "@/lib/format";

function sumByDate(records) {
  const map = {};
  records.forEach((r) => {
    map[r.date] = (map[r.date] || 0) + (Number(r.total) || 0);
  });
  return map;
}

function seriesFor(days) {
  const out = [];
  for (let i = days - 1; i >= 0; i -= 1) out.push(daysAgoISO(i));
  return out;
}

export function useOverview() {
  const [state, setState] = useState({ loading: true, error: null, overview: null });
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const now = new Date();
      const start = monthStartISO(now);
      const end = toISO(new Date(now.getFullYear(), now.getMonth() + 1, 0));
      try {
        const [monthPage, recentPage] = await Promise.all([
          base44.entities.ShoppingRecord.filter(
            { date: { $gte: start, $lte: end } },
            { sort: "-date", limit: 500 },
          ),
          base44.entities.ShoppingRecord.list({ sort: "-created_date", limit: 4 }),
        ]);
        if (cancelled) return;

        const month = monthPage.items || [];
        const map = sumByDate(month);
        const today = todayISO();
        const yesterday = daysAgoISO(1);
        const last7 = seriesFor(7).map((d) => map[d] || 0);
        const daily14 = seriesFor(14).map((d) => map[d] || 0);

        setState({
          loading: false,
          error: null,
          overview: {
            todayTotal: map[today] || 0,
            yesterdayTotal: map[yesterday] || 0,
            monthTotal: month.reduce((s, r) => s + (Number(r.total) || 0), 0),
            entriesMonth: month.length,
            entriesToday: month.filter((r) => r.date === today).length,
            last7,
            daily14,
            avgPerDay: month.reduce((s, r) => s + (Number(r.total) || 0), 0) / now.getDate(),
            recent: recentPage.items || [],
          },
        });
      } catch (err) {
        if (cancelled) return;
        setState({ loading: false, error: err, overview: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  return { ...state, reload };
}