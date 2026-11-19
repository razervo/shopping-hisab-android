import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { inr, todayISO } from "@/lib/format";
import { amountOf, emptyItem, normalizeShoppingUnit, toFormItems } from "@/lib/shopping";
import { ItemRow } from "@/components/shopping/ItemRow";
import { EstimateBar } from "@/components/shopping/EstimateBar";
import { BillUploader } from "@/components/shopping/BillUploader";
import { estimateMarketRates } from "@/lib/server-fns";
import { clearDraft, loadDraft, saveDraft } from "@/lib/draft";

export function RecordForm({
  initial,
  submitLabel = "Save shopping",
  saving = false,
  onSave,
  footerNote,
  allowEstimate = false,
  onActualListUploaded,
  billFileUri = "",
}) {
  const [shopName, setShopName] = useState(initial?.shop_name || "");
  const [date, setDate] = useState(initial?.date || todayISO());
  const [notes, setNotes] = useState(initial?.notes || "");
  const [items, setItems] = useState(() =>
    initial?.items?.length ? toFormItems(initial.items) : [emptyItem()],
  );
  const [error, setError] = useState("");
  const [estimating, setEstimating] = useState(false);
  const [estimateMsg, setEstimateMsg] = useState("");
  const [estimatedIds, setEstimatedIds] = useState(() => new Set(initial?.estimatedIds || []));
  const [restored, setRestored] = useState(false);
  const [actualUploadMessage, setActualUploadMessage] = useState("");
  const estimateFn = estimateMarketRates;

  // A list built at home is kept on this phone, so the real shop prices can be
  // filled in later, right before it is saved.
  useEffect(() => {
    if (!initial) {
      const draft = loadDraft();
      if (draft) {
        setShopName(draft.shopName || "");
        setDate(draft.date || todayISO());
        setNotes(draft.notes || "");
        if (Array.isArray(draft.items) && draft.items.length) setItems(draft.items);
        setEstimatedIds(new Set(draft.estimatedIds || []));
        setEstimateMsg("Your saved shopping list is back. Continue estimating or add the real shop prices.");
      }
    }
    setRestored(true);
  }, [initial]);

  useEffect(() => {
    if (!restored || (initial && !allowEstimate)) return;
    if (!items.some((item) => String(item.name || "").trim())) {
      clearDraft();
      return;
    }
    saveDraft({
      shopName,
      date,
      notes,
      items,
      estimatedIds: [...estimatedIds],
      billFileUri,
      kind: allowEstimate ? "uploaded_list" : "manual",
    });
  }, [restored, initial, allowEstimate, shopName, date, notes, items, estimatedIds, billFileUri]);

  const update = (id, patch) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
    if ("price" in patch && estimatedIds.has(id)) {
      setEstimatedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };
  const addItem = () => setItems((prev) => [...prev, emptyItem()]);
  const removeItem = (id) => {
    setItems((prev) => (prev.length > 1 ? prev.filter((i) => i.id !== id) : prev));
    setEstimatedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };
  const applyMarketRate = (id, rate) => {
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, price: String(rate), estimatedPrice: String(rate) } : i)),
    );
    setEstimatedIds((prev) => new Set([...prev, id]));
  };
  const confirmActualRate = (id) => {
    setEstimatedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const applyActualList = (pricedDraft, fileUri) => {
    const normalizeName = (value) =>
      String(value || "")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
        .replace(/(es|s)$/i, "");
    const matchedIds = new Set();
    const missed = [];
    const unitAliases = {
      gm: "g", gms: "g", gram: "g", grams: "g",
      kilo: "kg", kgs: "kg", kilogram: "kg", kilograms: "kg",
      millilitre: "ml", milliliter: "ml", millilitres: "ml", milliliters: "ml",
      litre: "l", liter: "l", litres: "l", liters: "l",
      packet: "pkt", packets: "pkt", pack: "pkt", packs: "pkt",
      piece: "pcs", pieces: "pcs", pc: "pcs",
    };
    const normalizeUnit = (unit) => {
      const key = String(unit || "").trim().toLowerCase().replace(/\\s+/g, "");
      return normalizeShoppingUnit(unit) || unitAliases[key] || key;
    };
    const unitScale = {
      g: { group: "mass", factor: 1 },
      kg: { group: "mass", factor: 1000 },
      ml: { group: "volume", factor: 1 },
      L: { group: "volume", factor: 1000 },
    };

    const nextItems = items.map((item) => ({ ...item }));
    (pricedDraft?.items || []).forEach((priced) => {
      const key = normalizeName(priced.name);
      if (!key) return;
      const index = nextItems.findIndex(
        (item) => !matchedIds.has(item.id) && normalizeName(item.name) === key,
      );
      if (index < 0) {
        if (priced.name) missed.push(String(priced.name));
        return;
      }

      const quantity = Number(priced.qty) > 0 ? Number(priced.qty) : 1;
      const lineAmount = Number(priced.amount) > 0 ? Number(priced.amount) : 0;
      // The uploaded list's right-hand price is normally the row total.
      // Prefer amount (line total) and derive the per-unit rate; this prevents
      // a ₹200 total for 5 kg rice being treated as ₹200 per kg.
      const rateInUploadedUnit = lineAmount > 0
        ? lineAmount / quantity
        : Number(priced.price) > 0
          ? Number(priced.price)
          : 0;
      if (rateInUploadedUnit <= 0) {
        if (priced.name) missed.push(String(priced.name));
        return;
      }

      const uploadedUnit = normalizeUnit(priced.unit || nextItems[index].unit);
      const plannedUnit = normalizeUnit(nextItems[index].unit || priced.unit);
      let actualRate = rateInUploadedUnit;
      if (uploadedUnit && plannedUnit && uploadedUnit !== plannedUnit) {
        const from = unitScale[uploadedUnit];
        const to = unitScale[plannedUnit];
        if (!from || !to || from.group !== to.group) {
          missed.push(String(priced.name));
          return;
        }
        actualRate = rateInUploadedUnit * (to.factor / from.factor);
      }

      nextItems[index] = {
        ...nextItems[index],
        price: String(Math.round(actualRate * 10000) / 10000),
      };
      matchedIds.add(nextItems[index].id);
    });

    if (matchedIds.size > 0) {
      setItems(nextItems);
      setEstimatedIds((prev) => {
        const next = new Set(prev);
        matchedIds.forEach((id) => next.delete(id));
        return next;
      });
      setActualUploadMessage(
        `Updated actual prices for ${matchedIds.size} item(s).${missed.length ? ` Not matched or no price found: ${missed.join(", ")}. Update those manually.` : " Review the updated prices and total before saving."}`,
      );
      if (fileUri) onActualListUploaded?.(fileUri);
    } else {
      setActualUploadMessage(
        "No priced items could be matched. Check that the uploaded list has the same item names, then enter prices manually.",
      );
    }
  };

  const filled = items.filter((i) => String(i.name).trim() && (Number(i.qty) || 0) > 0);
  const total = filled.reduce((sum, i) => sum + amountOf(i), 0);
  const estimatedCount = filled.filter((i) => estimatedIds.has(i.id) && Number(i.price) > 0).length;
  const unpricedCount = filled.filter((i) => !(Number(i.price) > 0)).length;
  const estimateReferenceCount = filled.filter(
    (i) => Number(i.estimatedPrice ?? i.estimated_price) > 0,
  ).length;
  const estimateReferenceTotal = filled.reduce(
    (sum, i) => sum + (Number(i.qty) || 0) * (Number(i.estimatedPrice ?? i.estimated_price) || 0),
    0,
  );

  const runEstimate = async () => {
    const targets = items.filter((i) => String(i.name).trim() && !(Number(i.price) > 0));
    const missingBrand = targets.find((i) =>
      (i.brandType === "branded" || i.brandType === "local_brand") && !String(i.brand || "").trim()
    );
    if (missingBrand) {
      setEstimateMsg(`Enter the brand name for "${missingBrand.name}" before estimating its price.`);
      return;
    }
    if (!targets.length) {
      setEstimateMsg("Every item already has a price. Edit any of them to re-estimate.");
      return;
    }
    setEstimating(true);
    setEstimateMsg("");
    try {
      const res = await estimateFn({
        data: {
          items: targets.map((i) => ({
            name: String(i.name).trim().slice(0, 80),
            unit: String(i.unit || "pcs").slice(0, 12),
            brandType: i.brandType || "unbranded",
            brand: String(i.brand || "").trim().slice(0, 80),
            variety: String(i.variety || "").trim().slice(0, 80),
          })),
        },
      });
      if (res?.error) {
        setEstimateMsg(res.error);
        return;
      }
      const rates = new Map();
      (res?.rates || []).forEach((r) => {
        const target = targets[r.index];
        if (target && r.rate > 0) rates.set(target.id, r.rate);
      });
      if (!rates.size) {
        setEstimateMsg("Could not estimate these items. Enter the prices yourself.");
        return;
      }
      setItems((prev) =>
        prev.map((i) =>
          rates.has(i.id)
            ? { ...i, price: rates.get(i.id), estimatedPrice: rates.get(i.id) }
            : i,
        ),
      );
      setEstimatedIds((prev) => new Set([...prev, ...rates.keys()]));
      setEstimateMsg("Rough total ready. Update each suggested price with the actual shop rate before saving.");
    } catch {
      setEstimateMsg("Could not estimate prices right now. Enter them yourself.");
    } finally {
      setEstimating(false);
    }
  };

  const clearList = () => {
    clearDraft();
    setItems([emptyItem()]);
    setShopName("");
    setNotes("");
    setDate(todayISO());
    setEstimatedIds(new Set());
    setEstimateMsg("");
  };

  const submit = (e) => {
    e.preventDefault();
    if (!date) return setError("Please choose the shopping date.");
    if (filled.length === 0) return setError("Add at least one item with a name and quantity.");
    if (estimatedCount > 0) {
      return setError(
        `There are ${estimatedCount} estimated item rate(s) remaining. Upload your priced list, enter the real shop rate, or confirm the suggested rate before saving.`,
      );
    }
    if (unpricedCount > 0) {
      return setError(`Enter an actual price for all ${unpricedCount} item(s) before saving.`);
    }
    if (total <= 0) return setError("Add a price for at least one item.");
    setError("");
    onSave({ shopName, date, notes, items: filled });
  };

  return (
    <form onSubmit={submit} className="space-y-4 pb-28">
      <div className="rounded-[24px] border border-border bg-white p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="shop" className="micro mb-1.5 block text-muted-foreground">
              Shop name
            </Label>
            <Input
              id="shop"
              value={shopName}
              onChange={(e) => setShopName(e.target.value)}
              placeholder="e.g. Sharma Kirana Store"
              className="h-11 text-[15px]"
            />
          </div>
          <div>
            <Label htmlFor="date" className="micro mb-1.5 block text-muted-foreground">
              Date
            </Label>
            <Input
              id="date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-11 text-[15px]"
            />
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {estimateReferenceCount > 0 ? (
          <div className="grid grid-cols-2 gap-2.5">
            <div className="rounded-2xl border border-border bg-white px-3 py-3">
              <p className="micro text-muted-foreground">Original market estimate</p>
              <p className="tnum mt-1 text-[17px] font-extrabold">{inr(estimateReferenceTotal)}</p>
              <p className="mt-0.5 text-[10.5px] text-muted-foreground">
                {estimateReferenceCount} of {filled.length} items
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-white px-3 py-3">
              <p className="micro text-muted-foreground">Current shopping total</p>
              <p className="tnum mt-1 text-[17px] font-extrabold">{inr(total)}</p>
              <p className="mt-0.5 text-[10.5px] text-muted-foreground">
                {estimatedCount > 0 ? "Includes estimated rates" : "Updated prices"}
              </p>
            </div>
          </div>
        ) : null}

        <div className="flex items-center justify-between px-1">
          <h2 className="text-[13px] font-bold tracking-wide">Items ({filled.length})</h2>
          <button
            type="button"
            onClick={addItem}
            className="inline-flex items-center gap-1 rounded-full bg-accent px-3 py-1.5 text-[12px] font-bold text-accent-foreground transition-colors hover:bg-accent/70"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={3} /> Add item
          </button>
        </div>

        {!initial || allowEstimate ? (
          <EstimateBar
            busy={estimating}
            message={estimateMsg}
            estimatedCount={estimatedCount}
            hasItems={filled.length > 0}
            onEstimate={runEstimate}
            onClear={clearList}
          />
        ) : null}

        {estimatedCount > 0 ? (
          <div className="rounded-[20px] border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-[12.5px] font-extrabold text-amber-900">
              Update your actual shopping prices
            </p>
            <p className="mt-1 text-[12px] leading-relaxed text-amber-900/80">
              {estimatedCount} item(s) still use rough market estimates. Replace each rate with the shop price you paid, or tap Confirm rate when the suggested price is exact. Your total recalculates automatically.
            </p>
          </div>
        ) : null}

        {allowEstimate && estimatedCount > 0 ? (
          <div className="space-y-2">
            <BillUploader
              compact
              purpose="priced_list"
              onExtracted={applyActualList}
            />
            {actualUploadMessage ? (
              <p className="rounded-xl bg-accent px-3 py-2.5 text-[11.5px] font-semibold leading-relaxed text-accent-foreground">
                {actualUploadMessage}
              </p>
            ) : null}
          </div>
        ) : null}

        {items.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            canRemove={items.length > 1}
            isEstimated={estimatedIds.has(item.id) && Number(item.price) > 0}
            onChange={(patch) => update(item.id, patch)}
            onApplyMarketRate={(rate) => applyMarketRate(item.id, rate)}
            onConfirmActual={() => confirmActualRate(item.id)}
            onRemove={() => removeItem(item.id)}
          />
        ))}

        <button
          type="button"
          onClick={addItem}
          className="flex w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-border py-3 text-[13px] font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
        >
          <Plus className="h-4 w-4" /> Add another item
        </button>
      </div>

      <div>
        <Label htmlFor="notes" className="micro mb-1.5 block text-muted-foreground">
          Notes (optional)
        </Label>
        <textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Anything to remember about this shopping"
          className="w-full rounded-xl border border-input bg-white px-3 py-2.5 text-[14px] outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      {error ? (
        <p className="rounded-xl bg-destructive/10 px-4 py-3 text-[13px] font-semibold text-destructive">{error}</p>
      ) : null}

      <div className="fixed inset-x-0 bottom-[68px] z-30 border-t border-border bg-white/95 px-4 py-3 backdrop-blur-md">
        <div className="mx-auto flex max-w-2xl items-center gap-4">
          <div className="min-w-0 flex-1">
            <p className="micro text-muted-foreground">
              {estimatedCount > 0 ? "Estimated + actual total" : "Actual shopping total"}
            </p>
            <p className="tnum text-[22px] font-extrabold leading-tight">{inr(total)}</p>
            {footerNote ? (
              <p className="truncate text-[11px] text-muted-foreground">{footerNote}</p>
            ) : null}
            {unpricedCount > 0 ? (
              <p className="truncate text-[10.5px] font-semibold text-amber-700">
                {unpricedCount} item(s) still need a price
              </p>
            ) : null}
          </div>
          <button
            type="submit"
            disabled={saving}
            className="rounded-full bg-primary px-6 py-3 text-[14px] font-bold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-60"
          >
            {saving ? "Saving…" : submitLabel}
          </button>
        </div>
      </div>
    </form>
  );
}