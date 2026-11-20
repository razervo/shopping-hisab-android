import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, CalendarDays, Loader2, Plus, RefreshCw, ShoppingBasket, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authed/sessions/$sessionId")({
  head: () => ({ meta: [{ title: "Shopping Session · Shopping Hisab" }] }),
  component: SessionDetailPage,
});

const inr = (paise) => new Intl.NumberFormat("en-IN", {
  style: "currency", currency: "INR", maximumFractionDigits: 2,
}).format(Number(paise || 0) / 100);

const dateLabel = (value) => value
  ? new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })
  : "Date not set";

const blankRow = () => ({ name: "", quantity: "1", unit: "pcs", brand: "", pack_size: "" });

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "include",
    ...options,
    headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed. Please try again.");
  return data;
}

function SessionDetailPage() {
  const { sessionId } = Route.useParams();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [listName, setListName] = useState("My shopping list");
  const [rows, setRows] = useState([blankRow()]);
  const [billForm, setBillForm] = useState({ shop_name: "", purchase_date: new Date().toISOString().slice(0, 10), receipt_number: "", bill_total: "" });
  const [billSaving, setBillSaving] = useState(false);

  const loadSession = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api(`/api/shopping/sessions/${sessionId}`);
      setSession(data);
    } catch (cause) {
      setError(cause.message || "Could not load this session.");
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => { loadSession(); }, [loadSession]);

  const updateRow = (index, key, value) => {
    setRows((current) => current.map((row, i) => i === index ? { ...row, [key]: value } : row));
  };

  const addRow = () => setRows((current) => [...current, blankRow()]);
  const removeRow = (index) => setRows((current) => current.length === 1
    ? [blankRow()] : current.filter((_, i) => i !== index));

  const saveBill = async (event) => {
    event.preventDefault();
    const rupees = Number(billForm.bill_total);
    if (!Number.isFinite(rupees) || rupees < 0 || !Number.isSafeInteger(Math.round(rupees * 100))) {
      toast.error("Enter a valid bill total.");
      return;
    }
    setBillSaving(true);
    try {
      await api(`/api/shopping/sessions/${sessionId}/bills`, {
        method: "POST",
        body: JSON.stringify({
          shop_name: billForm.shop_name.trim(),
          purchase_date: billForm.purchase_date || null,
          receipt_number: billForm.receipt_number.trim(),
          bill_total_paise: Math.round(rupees * 100),
          original_ocr: { entry_method: "manual" },
        }),
      });
      toast.success("Bill added to actual spending.");
      setBillForm({ shop_name: "", purchase_date: new Date().toISOString().slice(0, 10), receipt_number: "", bill_total: "" });
      await loadSession();
    } catch (cause) {
      toast.error(cause.message || "Could not add this bill.");
    } finally {
      setBillSaving(false);
    }
  };

  const saveList = async (event) => {
    event.preventDefault();
    const validRows = rows.map((row) => ({
      ...row,
      name: row.name.trim(),
      quantity: Number(row.quantity),
    })).filter((row) => row.name);
    if (!validRows.length) {
      toast.error("Enter at least one item name.");
      return;
    }
    if (validRows.some((row) => !Number.isFinite(row.quantity) || row.quantity < 0)) {
      toast.error("Check the quantity for each item.");
      return;
    }

    setSaving(true);
    try {
      const sourceList = await api(`/api/shopping/sessions/${sessionId}/lists`, {
        method: "POST",
        body: JSON.stringify({
          source_type: "manual_entry",
          source_metadata: { title: listName.trim() || "Manual shopping list" },
        }),
      });
      const lineResult = await api(`/api/shopping/sessions/${sessionId}/lists/${sourceList.id}/lines`, {
        method: "POST",
        body: JSON.stringify({
          lines: validRows.map((row, index) => ({
            line_number: index + 1,
            original_name: row.name,
            recognized_name: row.name,
            brand: row.brand.trim(),
            pack_size: row.pack_size.trim(),
            quantity: row.quantity,
            unit: row.unit.trim() || "pcs",
            original_ocr: { entry_method: "manual" },
          })),
        }),
      });
      for (let index = 0; index < validRows.length; index++) {
        const row = validRows[index];
        await api(`/api/shopping/sessions/${sessionId}/items`, {
          method: "POST",
          body: JSON.stringify({
            product_name: row.name,
            planned_quantity: row.quantity,
            unit: row.unit.trim() || "pcs",
            brand: row.brand.trim(),
            pack_size: row.pack_size.trim(),
            source_line_id: lineResult.line_ids[index],
          }),
        });
      }
      toast.success(`${validRows.length} ${validRows.length === 1 ? "item" : "items"} added`);
      setListName("My shopping list");
      setRows([blankRow()]);
      await loadSession();
    } catch (cause) {
      toast.error(cause.message || "Could not save this list.");
      await loadSession();
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="space-y-3"><div className="h-8 w-2/3 animate-pulse rounded bg-muted" /><div className="h-36 animate-pulse rounded-[24px] bg-muted" /><div className="h-56 animate-pulse rounded-[24px] bg-muted" /></div>;
  }

  if (error || !session) {
    return <div className="rounded-[22px] border border-border px-5 py-8 text-center">
      <p className="text-sm font-bold">{error || "Shopping session not found."}</p>
      <button type="button" onClick={loadSession} className="mt-3 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground">Try again</button>
      <Link to="/sessions" className="mt-3 block text-sm underline">Back to sessions</Link>
    </div>;
  }

  const items = session.items || [];
  const lists = session.source_lists || [];
  const completed = session.status === "completed";

  return (
    <div className="pb-5">
      <Link to="/sessions" className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground">
        <ArrowLeft className="h-4 w-4" /> All sessions
      </Link>

      <div className="rounded-[24px] bg-primary p-5 text-primary-foreground">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wider text-white/65">Shopping session</p>
            <h1 className="mt-1 break-words text-[22px] font-extrabold leading-tight">{session.name || "Shopping session"}</h1>
            <p className="mt-2 flex items-center gap-1.5 text-[12px] text-white/75"><CalendarDays className="h-3.5 w-3.5" />{dateLabel(session.shopping_date)}</p>
          </div>
          <span className="shrink-0 rounded-full bg-white/15 px-3 py-1.5 text-[10.5px] font-bold">{completed ? "Completed" : "Open"}</span>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 border-t border-white/15 pt-4">
          <div><p className="text-[11px] text-white/65">Actual spending</p><p className="mt-1 text-[20px] font-extrabold tabular-nums">{inr(session.actual_total_paise)}</p></div>
          <div><p className="text-[11px] text-white/65">Bill amounts pending</p><p className="mt-1 text-[20px] font-extrabold tabular-nums">{Number(session.bills_amount_pending || 0)}</p></div>
        </div>
      </div>

      {!completed ? (
        <form onSubmit={saveList} className="mt-5 space-y-3 rounded-[24px] border border-border bg-white p-4">
          <div>
            <p className="text-[15px] font-extrabold">Add a shopping list</p>
            <p className="mt-1 text-[12px] text-muted-foreground">Enter items manually now. Scanned handwritten lists will connect here in the next step.</p>
          </div>
          <div>
            <label htmlFor="list-name" className="mb-1 block text-[11.5px] font-bold text-muted-foreground">List name</label>
            <input id="list-name" value={listName} onChange={(event) => setListName(event.target.value)}
              maxLength={120} className="h-10 w-full rounded-xl border border-border bg-background px-3 text-[13px]" />
          </div>
          {rows.map((row, index) => (
            <div key={index} className="rounded-[18px] bg-secondary/50 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-bold text-muted-foreground">Item {index + 1}</span>
                <button type="button" onClick={() => removeRow(index)} aria-label={`Remove item ${index + 1}`} className="rounded-full p-1.5 text-muted-foreground hover:bg-white">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <input value={row.name} onChange={(event) => updateRow(index, "name", event.target.value)}
                placeholder="Item name (e.g. Rice)" maxLength={160}
                className="h-10 w-full rounded-xl border border-border bg-white px-3 text-[13px]" />
              <div className="mt-2 grid grid-cols-[1fr_1fr] gap-2">
                <input type="number" min="0" step="0.01" value={row.quantity}
                  onChange={(event) => updateRow(index, "quantity", event.target.value)}
                  aria-label={`Quantity for item ${index + 1}`} placeholder="Quantity"
                  className="h-10 min-w-0 rounded-xl border border-border bg-white px-3 text-[13px]" />
                <input value={row.unit} onChange={(event) => updateRow(index, "unit", event.target.value)}
                  aria-label={`Unit for item ${index + 1}`} placeholder="Unit (kg, pcs)"
                  className="h-10 min-w-0 rounded-xl border border-border bg-white px-3 text-[13px]" />
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input value={row.brand} onChange={(event) => updateRow(index, "brand", event.target.value)}
                  placeholder="Brand (optional)" maxLength={100}
                  className="h-9 min-w-0 rounded-lg border border-border bg-white px-2.5 text-[12px]" />
                <input value={row.pack_size} onChange={(event) => updateRow(index, "pack_size", event.target.value)}
                  placeholder="Pack size (optional)" maxLength={60}
                  className="h-9 min-w-0 rounded-lg border border-border bg-white px-2.5 text-[12px]" />
              </div>
            </div>
          ))}
          <button type="button" onClick={addRow} className="flex w-full items-center justify-center gap-1.5 rounded-full border border-dashed border-border py-2.5 text-[12.5px] font-bold">
            <Plus className="h-4 w-4" /> Add another item
          </button>
          <button type="submit" disabled={saving} className="flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3 text-[13.5px] font-bold text-primary-foreground disabled:opacity-60">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {saving ? "Saving list…" : "Save shopping list"}
          </button>
        </form>
      ) : null}

      <section className="mt-6">
        <div className="mb-3 flex items-center justify-between px-1">
          <div><h2 className="text-[15px] font-extrabold">Planned items</h2><p className="text-[11.5px] text-muted-foreground">{items.length} items in this session</p></div>
          <button type="button" onClick={loadSession} aria-label="Refresh session" className="rounded-full border border-border p-2"><RefreshCw className="h-4 w-4" /></button>
        </div>
        {items.length ? (
          <div className="overflow-hidden rounded-[22px] border border-border bg-white">
            {items.map((item, index) => (
              <div key={item.id} className="flex items-center justify-between gap-3 px-4 py-3" style={{ borderTop: index ? "1px solid hsl(var(--border) / 0.8)" : "none" }}>
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] font-bold">{item.product_name}</p>
                  <p className="mt-0.5 text-[11.5px] text-muted-foreground">{Number(item.planned_quantity)} {item.unit}{item.brand ? ` · ${item.brand}` : ""}{item.pack_size ? ` · ${item.pack_size}` : ""}</p>
                </div>
                <span className="shrink-0 rounded-full bg-secondary px-2.5 py-1 text-[10px] font-bold capitalize">{String(item.item_status || "planned").replaceAll("_", " ")}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-[22px] border border-dashed border-border px-5 py-7 text-center">
            <ShoppingBasket className="mx-auto h-6 w-6 text-muted-foreground" />
            <p className="mt-2 text-[13px] font-bold">No planned items yet</p>
            <p className="mt-1 text-[12px] text-muted-foreground">Add your first list above.</p>
          </div>
        )}
      </section>

      <section className="mt-6">
        <h2 className="mb-3 px-1 text-[15px] font-extrabold">Source lists</h2>
        {lists.length ? <div className="space-y-2">
          {lists.map((list) => (
            <div key={list.id} className="rounded-[18px] border border-border bg-white px-4 py-3">
              <p className="text-[13px] font-bold">{list.source_metadata_json ? (() => { try { return JSON.parse(list.source_metadata_json).title || "Shopping list"; } catch { return "Shopping list"; } })() : "Shopping list"}</p>
              <p className="mt-1 text-[11px] capitalize text-muted-foreground">{String(list.source_type).replaceAll("_", " ")} · {String(list.ocr_status).replaceAll("_", " ")}</p>
            </div>
          ))}
        </div> : <p className="rounded-[18px] bg-secondary/40 px-4 py-4 text-[12px] text-muted-foreground">Lists added to this session will appear here.</p>}
      </section>

      {!completed ? (
        <form onSubmit={saveBill} className="mt-6 space-y-3 rounded-[24px] border border-border bg-white p-4">
          <div>
            <p className="text-[15px] font-extrabold">Add actual bill</p>
            <p className="mt-1 text-[12px] text-muted-foreground">Record the amount you paid at each shop. This amount is counted immediately in actual spending.</p>
          </div>
          <input value={billForm.shop_name} onChange={(event) => setBillForm((v) => ({ ...v, shop_name: event.target.value }))}
            placeholder="Shop name" maxLength={160} className="h-10 w-full rounded-xl border border-border bg-background px-3 text-[13px]" />
          <div className="grid grid-cols-2 gap-2">
            <input type="date" value={billForm.purchase_date} onChange={(event) => setBillForm((v) => ({ ...v, purchase_date: event.target.value }))}
              className="h-10 min-w-0 rounded-xl border border-border bg-background px-3 text-[12px]" />
            <input value={billForm.receipt_number} onChange={(event) => setBillForm((v) => ({ ...v, receipt_number: event.target.value }))}
              placeholder="Receipt no. (optional)" maxLength={100} className="h-10 min-w-0 rounded-xl border border-border bg-background px-3 text-[12px]" />
          </div>
          <input type="number" inputMode="decimal" min="0" step="0.01" value={billForm.bill_total}
            onChange={(event) => setBillForm((v) => ({ ...v, bill_total: event.target.value }))}
            placeholder="Total paid (₹)" required className="h-11 w-full rounded-xl border border-border bg-background px-3 text-[14px] font-semibold" />
          <button type="submit" disabled={billSaving} className="flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3 text-[13px] font-bold text-primary-foreground disabled:opacity-60">
            {billSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {billSaving ? "Adding bill…" : "Add bill amount"}
          </button>
        </form>
      ) : null}

      <section className="mt-6">
        <h2 className="mb-3 px-1 text-[15px] font-extrabold">Actual bills</h2>
        {(session.bills || []).length ? (
          <div className="space-y-2">{session.bills.map((bill) => (
            <div key={bill.id} className="flex items-center justify-between rounded-[18px] border border-border bg-white px-4 py-3">
              <div><p className="text-[13px] font-bold">{bill.shop_name || "Shop not named"}</p><p className="mt-1 text-[11px] text-muted-foreground">{bill.receipt_number || "Receipt number not recorded"} · {String(bill.bill_status).replaceAll("_", " ")}</p></div>
              <p className="text-[13px] font-extrabold tabular-nums">{bill.bill_total_paise == null ? "Amount pending" : inr(bill.bill_total_paise)}</p>
            </div>
          ))}</div>
        ) : <p className="rounded-[18px] bg-secondary/40 px-4 py-4 text-[12px] text-muted-foreground">No actual bills added yet. Bill capture will be connected next.</p>}
      </section>

      <section className="mt-6">
        <h2 className="mb-3 px-1 text-[15px] font-extrabold">Estimate versions</h2>
        {(session.estimates || []).length ? (
          <div className="space-y-2">{session.estimates.map((estimate) => (
            <div key={estimate.id} className="flex items-center justify-between rounded-[18px] border border-border bg-white px-4 py-3">
              <div><p className="text-[13px] font-bold">Estimate v{estimate.version_number}</p><p className="mt-1 text-[11px] text-muted-foreground">{new Date(estimate.created_at).toLocaleString("en-IN")}</p></div>
              <p className="text-[13px] font-extrabold tabular-nums">{inr(estimate.estimated_total_paise)}</p>
            </div>
          ))}</div>
        ) : <p className="rounded-[18px] bg-secondary/40 px-4 py-4 text-[12px] text-muted-foreground">Your first estimate will appear here after price estimation is connected.</p>}
      </section>
    </div>
  );
}
