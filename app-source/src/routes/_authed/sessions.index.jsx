import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { CalendarDays, ChevronRight, Loader2, Plus, RefreshCw, ShoppingBag } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authed/sessions/")({
  head: () => ({ meta: [{ title: "Shopping Trips · Shopping Hisab" }] }),
  component: SessionsPage,
});

const localDate = () => {
  const date = new Date();
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
};

const inr = (paise) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 })
    .format(Number(paise || 0) / 100);

const prettyDate = (value) => {
  if (!value) return "Date not set";
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });
};

function SessionsPage() {
  const navigate = useNavigate();
  const createSessionKeyRef = useRef(null);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [date, setDate] = useState(localDate);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/shopping/sessions", { credentials: "include", cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Could not load your shopping trips.");
      setSessions(Array.isArray(result.sessions) ? result.sessions : []);
    } catch (cause) {
      setError(cause.message || "Could not load your shopping trips.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  const createSession = async (event) => {
    event.preventDefault();
    if (!date) {
      toast.error("Choose a shopping date.");
      return;
    }
    const sessionPayload = JSON.stringify({ name: name.trim(), shopping_date: date });
    if (!createSessionKeyRef.current || createSessionKeyRef.current.payload !== sessionPayload) {
      createSessionKeyRef.current = { payload: sessionPayload, key: crypto.randomUUID() };
    }
    setCreating(true);
    try {
      const response = await fetch("/api/shopping/sessions", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "Idempotency-Key": createSessionKeyRef.current.key },
        body: sessionPayload,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Could not start this shopping trip.");
      createSessionKeyRef.current = null;
      setName("");
      toast.success("Your shopping trip is ready");
      navigate({ to: "/sessions/$sessionId", params: { sessionId: result.id } });
      await loadSessions();
    } catch (cause) {
      toast.error(cause.message || "Could not start this shopping trip.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="pb-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="micro text-primary">LET'S PLAN YOUR SHOPPING</p>
          <h1 className="mt-2 text-[27px] font-extrabold leading-tight tracking-tight">Shopping trips</h1>
          <p className="mt-1 max-w-[35ch] text-[13.5px] leading-relaxed text-muted-foreground">
            Keep your list, estimated cost and bills together for each trip.
          </p>
        </div>
        <button type="button" onClick={loadSessions} disabled={loading} aria-label="Refresh shopping trips"
          className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-white">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <form onSubmit={createSession} className="mt-5 space-y-3 rounded-[24px] border border-emerald-100 bg-white p-4 shadow-[0_2px_12px_rgba(15,23,42,0.04)]">
        <div>
          <label htmlFor="session-name" className="mb-1.5 block text-[12px] font-bold text-muted-foreground">Give this trip a name (optional)</label>
          <input id="session-name" value={name} onChange={(event) => setName(event.target.value)}
            maxLength={120} placeholder="e.g. Monthly groceries"
            className="h-11 w-full rounded-xl border border-border bg-background px-3 text-[14px] outline-none focus:ring-2 focus:ring-primary/20" />
        </div>
        <div>
          <label htmlFor="session-date" className="mb-1.5 block text-[12px] font-bold text-muted-foreground">When are you shopping?</label>
          <div className="relative">
            <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input id="session-date" type="date" required value={date} onChange={(event) => setDate(event.target.value)}
              className="h-11 w-full rounded-xl border border-border bg-background pl-10 pr-3 text-[14px] outline-none focus:ring-2 focus:ring-primary/20" />
          </div>
        </div>
        <button type="submit" disabled={creating}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 text-[14px] font-bold text-primary-foreground disabled:opacity-60">
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {creating ? "Preparing…" : "Create my shopping trip"}
        </button>
      </form>

      <div className="mb-3 mt-6 flex items-center justify-between px-1">
        <h2 className="text-[14px] font-extrabold">Your trips</h2>
        <span className="text-[11.5px] text-muted-foreground">{sessions.length} shown</span>
      </div>

      {loading ? (
        <div className="space-y-2.5">
          {[0, 1, 2].map((key) => <div key={key} className="h-[92px] animate-pulse rounded-[20px] bg-muted" />)}
        </div>
      ) : error ? (
        <div className="rounded-[22px] bg-destructive/10 px-4 py-4 text-[13px] font-semibold text-destructive">
          {error}
          <button type="button" onClick={loadSessions} className="ml-2 underline">Retry</button>
        </div>
      ) : sessions.length === 0 ? (
        <div className="rounded-[22px] border border-dashed border-border bg-white/70 px-5 py-8 text-center">
          <ShoppingBag className="mx-auto h-7 w-7 text-muted-foreground" />
          <p className="mt-2 text-[14px] font-bold">No shopping trips yet</p>
          <p className="mt-1 text-[12.5px] text-muted-foreground">Create your first trip above. We'll keep your list and bills together.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {sessions.map((session) => (
            <Link key={session.id} to="/sessions/$sessionId" params={{ sessionId: session.id }} className="block rounded-[22px] border border-border bg-white p-4 shadow-[0_2px_10px_rgba(15,23,42,0.035)] transition-colors hover:bg-secondary/30">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14.5px] font-extrabold">{session.name || "Shopping trip"}</p>
                  <p className="mt-1 text-[12px] text-muted-foreground">{prettyDate(session.shopping_date)}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10.5px] font-bold ${session.status === "completed" ? "bg-secondary text-muted-foreground" : "bg-primary/10 text-primary"}`}>
                  {session.status === "completed" ? "Finished" : "In progress"}
                </span>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
                <div className="flex gap-4 text-[11.5px] text-muted-foreground">
                  <span>{Number(session.item_count || 0)} items</span>
                  <span>{Number(session.list_count || 0)} lists</span>
                </div>
                <span className="text-[13px] font-extrabold tabular-nums">{inr(session.actual_total_paise)}</span>
              </div>
              <p className="mt-2 text-[11px] font-semibold text-primary">{session.status === "completed" ? "View trip summary →" : "Continue shopping →"}</p>
            </Link>
          ))}
        </div>
      )}

      <Link to="/history" className="mt-5 flex items-center justify-center gap-2 rounded-full border border-border bg-white py-3 text-[13px] font-bold">
        View all my shopping <ChevronRight className="h-4 w-4" />
      </Link>
    </div>
  );
}
