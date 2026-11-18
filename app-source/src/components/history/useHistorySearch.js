import { useCallback, useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function buildQuery({ shop, from, to }) {
  const query = {};
  if (shop) query.shop_name = { $regex: escapeRegex(shop), $options: "i" };
  if (from || to) {
    query.date = {};
    if (from) query.date.$gte = from;
    if (to) query.date.$lte = to;
  }
  return query;
}

export function useHistorySearch(filters) {
  const { shop = "", from = "", to = "" } = filters || {};
  const [records, setRecords] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const page = await base44.entities.ShoppingRecord.filter(buildQuery({ shop, from, to }), {
          sort: "-date",
          limit: 30,
        });
        if (cancelled) return;
        setRecords(page.items || []);
        setCursor(page.next_cursor || null);
        setHasMore(Boolean(page.has_more));
      } catch (err) {
        if (!cancelled) setError(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shop, from, to]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await base44.entities.ShoppingRecord.filter(buildQuery({ shop, from, to }), {
        sort: "-date",
        limit: 30,
        cursor,
      });
      setRecords((prev) => [...prev, ...(page.items || [])]);
      setCursor(page.next_cursor || null);
      setHasMore(Boolean(page.has_more));
    } catch {
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, loadingMore, shop, from, to]);

  const count = records.length
    ? records.reduce((s, r) => s + (Number(r.total) || 0), 0)
    : null;

  return { records, loading, error, hasMore, loadMore, loadingMore, count };
}