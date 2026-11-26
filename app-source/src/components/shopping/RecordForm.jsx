import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ListPlus, Mic, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { inr, todayISO } from "@/lib/format";
import { amountOf, emptyItem, normalizeShoppingUnit, toFormItems } from "@/lib/shopping";
import { ItemRow } from "@/components/shopping/ItemRow";
import { EstimateBar } from "@/components/shopping/EstimateBar";
import { BillUploader } from "@/components/shopping/BillUploader";
import { estimateMarketRates } from "@/lib/server-fns";
import { clearDraft, loadDraft, saveDraft } from "@/lib/draft";
import { parseVoiceShoppingItems } from "@/lib/shopping-categories";

export function RecordForm({
  initial,
  submitLabel = "Save shopping",
  saving = false,
  onSave,
  footerNote,
  allowEstimate = false,
  allowActualReceiptUpload = false,
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
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkError, setBulkError] = useState("");
  const [voiceListening, setVoiceListening] = useState(false);
  const recognitionRef = useRef(null);
  const [receiptCount, setReceiptCount] = useState(() => Math.max(1, Array.isArray(initial?.receipts) ? initial.receipts.length : 0));
  const [receiptMessage, setReceiptMessage] = useState("");
  const [receipts, setReceipts] = useState(() => Array.isArray(initial?.receipts) ? initial.receipts : (billFileUri ? [{ id: "receipt-1", file_uri: billFileUri, kind: "shopping_list", status: "attached", amount: 0 }] : []));
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
  useEffect(() => () => {
    try { recognitionRef.current?.abort(); } catch (abortError) { /* recognition may already be stopped */ }
    recognitionRef.current = null;
  }, []);
  const stopVoiceEntry = () => {
    try { recognitionRef.current?.stop(); } catch (stopError) { /* ignore stop when recognition is inactive */ }
    recognitionRef.current = null;
    setVoiceListening(false);
  };
  const startVoiceEntry = () => {
    if (voiceListening) { stopVoiceEntry(); return; }
    const SpeechRecognitionApi = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
    if (!SpeechRecognitionApi) {
      toast.error("Voice input is not supported in this browser. Try Chrome or enter items manually.");
      return;
    }
    const recognition = new SpeechRecognitionApi();
    recognitionRef.current = recognition;
    recognition.lang = "en-IN";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => setVoiceListening(true);
    recognition.onend = () => { setVoiceListening(false); if (recognitionRef.current === recognition) recognitionRef.current = null; };
    recognition.onerror = (event) => {
      setVoiceListening(false);
      if (recognitionRef.current === recognition) recognitionRef.current = null;
      toast.error(event.error === "not-allowed" ? "Microphone permission was denied." : "Voice input failed. Please try again or enter items manually.");
    };
    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript || "";
      const names = parseVoiceShoppingItems(transcript);
      if (!names.length) {
        toast.info("No items recognized. Try saying: milk, eggs, rice.");
        return;
      }
      setBulkText((previous) => [previous.trim(), names.join("\\n")].filter(Boolean).join("\\n"));
      setBulkOpen(true);
      setBulkError("");
      toast.success("Voice captured. Review names before adding.");
    };
    try {
      recognition.start();
    } catch {
      setVoiceListening(false);
      recognitionRef.current = null;
      toast.error("Could not start voice input. Please try again.");
    }
  };
  const addBulkItems = () => {
    const parsed = String(bulkText || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
      const cells = line.includes("\t") ? line.split("\t") : line.includes("|") ? line.split("|") : line.includes(",") ? line.split(",") : null;
      if (cells && cells.length > 1) {
        const [rawName, rawQty, rawUnit, rawPrice] = cells.map((cell) => String(cell || "").trim());
        const quantity = Number(rawQty);
        return {
          ...emptyItem(),
          name: rawName,
          qty: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
          unit: normalizeShoppingUnit(rawUnit || "pcs") || "pcs",
          price: rawPrice && Number(rawPrice) > 0 ? rawPrice : "",
        };
      }
      const match = /^(.*?)\s+(\d+(?:\.\d+)?)\s*(kg|g|ml|l|litre|litres|ltr|pcs?|pieces?|pkt|packet|dozen|box)?$/i.exec(line);
      if (match) {
        return {
          ...emptyItem(),
          name: match[1].trim(),
          qty: Number(match[2]) || 1,
          unit: normalizeShoppingUnit(match[3] || "pcs") || "pcs",
        };
      }
      return { ...emptyItem(), name: line };
    }).filter((item) => item.name);
    if (!parsed.length) {
      setBulkError("Add at least one item, one per line.");
      return;
    }
    setItems((prev) => [...prev.filter((item) => String(item.name || "").trim()), ...parsed]);
    setBulkText("");
    setBulkError("");
    setBulkOpen(false);
    setEstimateMsg(`${parsed.length} item(s) added. Add prices or get rough estimates.`);
  };
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

  const appendActualReceipt = (extracted, fileUri) => {
    const incoming = (extracted?.items || []).filter((entry) => String(entry.name || "").trim());
    if (!incoming.length) { setActualUploadMessage("No readable items were found on this receipt. Try a clearer photo or enter prices manually."); return; }
    const imported = incoming.map((entry) => ({
      ...emptyItem(),
      name: String(entry.name || "").trim(),
      qty: Number(entry.qty) > 0 ? Number(entry.qty) : 1,
      unit: normalizeShoppingUnit(entry.unit || "pcs"),
      price: Number(entry.price) > 0 ? String(entry.price) : "",
      receiptRefs: [fileUri].filter(Boolean),
    }));
    setItems((prev) => [...prev.filter((item) => String(item.name || "").trim()), ...imported]);
    const actualTotal = Math.round(incoming.reduce((sum, entry) => sum + (Number(entry.amount) || (Number(entry.qty) || 1) * (Number(entry.price) || 0)), 0) * 100) / 100;
    const receipt = { id: `actual-receipt-${Date.now()}`, file_uri: fileUri || "", kind: "actual", status: "attached", amount: actualTotal, item_count: imported.length, merged_items: [], created_at: new Date().toISOString() };
    setReceipts((prev) => [...prev, receipt]);
    setReceiptCount((count) => count + 1);
    setActualUploadMessage(`Receipt imported: ${imported.length} item(s). Actual prices were imported where readable; review any missing prices before saving.`);
    if (fileUri) onActualListUploaded?.(fileUri);
    toast.success("Receipt imported", { description: `${imported.length} item(s) added from your bill.` });
  };

  const appendReceipt = (extracted, fileUri) => {
    const incoming = (extracted?.items || []).filter((entry) => String(entry.name || "").trim());
    if (!incoming.length) { setReceiptMessage("No readable items were found on this receipt."); return; }
    const next = items.filter((item) => String(item.name || "").trim()).map((item) => ({ ...item }));
    const mergedNames = [];
    incoming.forEach((entry) => {
      const unit = normalizeShoppingUnit(entry.unit || "pcs");
      const nameKey = String(entry.name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const candidateIndex = next.findIndex((item) => String(item.name || "").toLowerCase().replace(/[^a-z0-9]/g, "") === nameKey && normalizeShoppingUnit(item.unit || "pcs") === unit);
      const fresh = { ...emptyItem(), name: String(entry.name || "").trim(), qty: Number(entry.qty) > 0 ? Number(entry.qty) : 1, unit, price: Number(entry.price) > 0 ? String(entry.price) : "", receiptRefs: [fileUri].filter(Boolean) };
      if (candidateIndex < 0) { next.push(fresh); return; }
      const existing = next[candidateIndex];
      // Avoid interrupting list entry with browser-native dialogs. Duplicate rows are
      // preserved by default so quantities/prices are never merged without consent.
      next.push(fresh);
      toast.info("Similar item found", {
        description: `${existing.name} was kept as a separate entry so no quantity or price is changed.`,
      });
    });
    setItems(next);
    const receipt = { id: `receipt-${Date.now()}`, file_uri: fileUri || "", kind: "shopping_list", status: "attached", amount: Math.round(incoming.reduce((sum, item) => sum + (Number(item.amount) || (Number(item.qty) || 1) * (Number(item.price) || 0)), 0) * 100) / 100, item_count: incoming.length, merged_items: mergedNames, created_at: new Date().toISOString() };
    setReceipts((prev) => [...prev, receipt]);
    setReceiptCount((count) => count + 1);
    setReceiptMessage(`List ${receiptCount + 1} added successfully (${incoming.length} item(s)). Review it, add any other shopping lists, and upload your final bills only after shopping is complete.`);
    toast.success("Shopping list added", { description: `${incoming.length} item(s) captured. You can continue adding lists.` });
    if (fileUri) onActualListUploaded?.(fileUri);
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
      setReceipts((prev) => [...prev.map((receipt) => receipt.status === "pending" ? { ...receipt, status: "attached" } : receipt), { id: `actual-${Date.now()}`, file_uri: fileUri || "", kind: "actual", status: "attached", amount: Number(pricedDraft?.total) || 0, item_count: matchedIds.size, merged_items: [], created_at: new Date().toISOString() }]);
    } else {
      setActualUploadMessage(
        "No priced items could be matched. Check that the uploaded list has the same item names, then enter prices manually.",
      );
    }
  };

  const filled = items.filter((i) => String(i.name).trim() && (Number(i.qty) || 0) > 0);
  const actualTotal = filled.reduce((sum, i) => sum + (estimatedIds.has(i.id) ? 0 : amountOf(i)), 0);
  const estimatedTotal = filled.reduce((sum, i) => sum + (estimatedIds.has(i.id) ? amountOf(i) : 0), 0);
  const total = actualTotal;
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
    const incomplete = items.filter((i) => String(i.name || "").trim() && (!(Number(i.qty) > 0) || !String(i.unit || "").trim()));
    if (incomplete.length) {
      const labels = incomplete.map((i) => String(i.name || "Unnamed item").trim()).slice(0, 5).join(", ");
      window.alert(`Complete quantity and unit for: ${labels}${incomplete.length > 5 ? " and more" : ""} before estimating.`);
      return;
    }
    const targets = items.filter((i) => String(i.name).trim() && !(Number(i.price) > 0));
    if (!targets.length) {
      setEstimateMsg("Every item already has a price. Edit any of them to re-estimate.");
      return;
    }
    setEstimating(true);
    setEstimateMsg(`Estimating 0 of ${targets.length} items…`);
    const collected = new Map();
    const failures = [];
    try {
      // Small batches reduce output truncation and let successful results survive
      // a temporary failure on another batch.
      const batches = [];
      for (let i = 0; i < targets.length; i += 8) batches.push(targets.slice(i, i + 8));
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
        const batch = batches[batchIndex];
        try {
          const res = await estimateFn({
            data: {
              items: batch.map((i) => ({
                name: String(i.name).trim().slice(0, 80),
                unit: String(i.unit || "pcs").slice(0, 12),
                productType: i.productType || "unsure",
                brand: String(i.brand || "").slice(0, 60),
                packSize: String(i.packSize || "").slice(0, 40),
              })),
            },
          });
          if (res?.error) throw new Error(res.error);
          const returned = new Set();
          (res?.rates || []).forEach((r) => {
            const target = batch[r.index];
            const rate = Number(r.rate);
            if (target && Number.isFinite(rate) && rate > 0) {
              collected.set(target.id, rate);
              returned.add(target.id);
            }
          });
          const missing = batch.filter((item) => !returned.has(item.id));
          for (const item of missing) {
            try {
              const single = await estimateFn({ data: { name: String(item.name).trim().slice(0, 80), unit: String(item.unit || "pcs").slice(0, 12), productType: item.productType || "unsure", brand: String(item.brand || "").slice(0, 60), packSize: String(item.packSize || "").slice(0, 40) } });
              const rate = Number(single?.suggestion?.rate ?? single?.rate);
              if (!single?.error && Number.isFinite(rate) && rate > 0) collected.set(item.id, rate);
              else failures.push(item.name);
            } catch (retryError) {
              failures.push(item.name);
              console.warn("Individual estimate retry failed:", item.name, retryError);
            }
          }
        } catch (cause) {
          failures.push(...batch.map((item) => item.name));
          console.warn("Shopping Hisab estimate batch failed:", cause);
        }
        setEstimateMsg(`Estimating ${Math.min((batchIndex + 1) * 8, targets.length)} of ${targets.length} items…`);
      }
      if (collected.size) {
        setItems((prev) =>
          prev.map((i) =>
            collected.has(i.id)
              ? { ...i, price: String(collected.get(i.id)), estimatedPrice: String(collected.get(i.id)) }
              : i,
          ),
        );
        setEstimatedIds((prev) => new Set([...prev, ...collected.keys()]));
      }
      if (failures.length) {
        const names = [...new Set(failures)].slice(0, 4).join(", ");
        setEstimateMsg(
          collected.size
            ? `Estimated ${collected.size} of ${targets.length}. Still need rates for: ${names}${failures.length > 4 ? " and others" : ""}. Tap Estimate again to retry only unpriced items.`
            : `No prices returned. ${names ? `Items: ${names}. ` : ""}Check your connection or AI service availability, then retry.`,
        );
      } else {
        setEstimateMsg(`AI estimates added for all ${collected.size} item(s). These are indicative, not live shop prices. Check local rates and replace them before saving.`);
      }
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
    const reconciliationStatus = receipts.some((receipt) => receipt.status === "skipped") ? "partial" : receipts.some((receipt) => receipt.kind === "actual") ? "complete" : "not_required";
    onSave({ shopName, date, notes, items: filled, receipts, reconciliationStatus });
  };

  return (
    <form onSubmit={submit} className="w-full min-w-0 space-y-4 overflow-x-clip pb-32">
      <div className="rounded-[20px] border border-border bg-white p-3.5">
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
            <div className="rounded-[18px] border border-border bg-white px-3 py-3">
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

        <div className="flex flex-col gap-2 px-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-[13px] font-bold tracking-wide">Items ({filled.length})</h2>
            <p className="mt-0.5 text-[10.5px] text-muted-foreground">Add items, paste a list, or scan another receipt</p>
          </div>
          <div className="flex w-full min-w-0 flex-wrap gap-2 sm:w-auto sm:justify-end">
            <button
              type="button"
              onClick={startVoiceEntry}
              aria-pressed={voiceListening}
              className={`inline-flex min-h-10 min-w-0 flex-1 items-center justify-center gap-1 rounded-full border px-3 py-2 text-xs font-bold sm:flex-none ${voiceListening ? "border-destructive bg-destructive/10 text-destructive" : "border-border bg-white text-foreground"}`}
            >
              <Mic className="h-3.5 w-3.5" /> {voiceListening ? "Stop voice" : "Add by voice"}
            </button>
            <button
              onClick={() => { setBulkOpen((open) => !open); setBulkError(""); }}
              className="inline-flex min-h-10 min-w-0 flex-1 items-center justify-center gap-1 rounded-full border border-border bg-white px-2 py-2 text-xs font-bold text-foreground sm:flex-none"
            >
              <ListPlus className="h-3.5 w-3.5" /> {bulkOpen ? "Close" : "Paste multiple"}
            </button>
            <button
              type="button"
              onClick={addItem}
              className="inline-flex min-h-10 min-w-0 flex-1 items-center justify-center gap-1 rounded-full bg-accent px-2 py-2 text-xs font-bold text-accent-foreground transition-colors hover:bg-accent/70 sm:flex-none"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={3} /> Add item
            </button>
          </div>
        </div>
        {bulkOpen ? (
          <div className="space-y-2 rounded-[18px] border border-border bg-white p-3">
            <p className="text-[12px] font-bold">Paste multiple items</p>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              One item per line. Use <span className="font-semibold">Rice 5 kg</span> or columns:
              <span className="font-semibold"> Milk, 2, L, 60</span> (name, quantity, unit, price per unit).
            </p>
            <textarea
              value={bulkText}
              onChange={(event) => { setBulkText(event.target.value); setBulkError(""); }}
              rows={5}
              placeholder={"Rice 5 kg\nSugar 2 kg\nMilk, 2, L, 60\nEggs, 12, pcs"}
              className="w-full rounded-xl border border-input bg-secondary/20 px-3 py-2.5 text-[13px] outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
            {bulkError ? <p className="text-[11px] font-semibold text-destructive">{bulkError}</p> : null}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setBulkOpen(false)} className="rounded-full px-3 py-2 text-[11px] font-semibold text-muted-foreground">Cancel</button>
              <button type="button" onClick={addBulkItems} className="rounded-full bg-primary px-4 py-2 text-[11px] font-bold text-primary-foreground">Add items to list</button>
            </div>
          </div>
        ) : null}

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

        {(allowEstimate || allowActualReceiptUpload) ? (
          <div className="space-y-2 rounded-[18px] border border-dashed border-border bg-white p-3">
            <div>
              <p className="text-[12.5px] font-bold">{allowActualReceiptUpload ? "Upload receipt / bill" : `Shopping lists added: ${receiptCount}`}</p>
              <p className="text-[11px] text-muted-foreground">{allowActualReceiptUpload ? "Upload the completed shop's bill to import actual paid prices and attach it to this purchase." : "Scan another receipt to add its items to this same shopping list."}</p>
            </div>
            <BillUploader compact purpose={allowActualReceiptUpload ? "priced_list" : "shopping_list"} onExtracted={allowActualReceiptUpload ? appendActualReceipt : appendReceipt} />
            {receiptMessage ? <p className="text-[11px] font-semibold text-primary">{receiptMessage}</p> : null}
            {allowActualReceiptUpload && actualUploadMessage ? <p className="text-[11px] font-semibold text-primary">{actualUploadMessage}</p> : null}
          </div>
        ) : null}

        {allowEstimate && actualUploadMessage ? (
          <p className="rounded-xl bg-accent px-3 py-2.5 text-[11.5px] font-semibold leading-relaxed text-accent-foreground">{actualUploadMessage}</p>
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

      <div className="fixed inset-x-0 bottom-[68px] z-30 border-t border-border bg-white/95 px-3.5 py-3 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-2xl min-w-0 items-center gap-2 sm:gap-4">
          <div className="min-w-0 flex-1">
            <p className="micro text-muted-foreground">Actual spend (estimates excluded)</p>
            <p className="tnum text-[22px] font-extrabold leading-tight">{inr(total)}</p>
            {estimatedTotal > 0 ? <p className="truncate text-[10.5px] text-amber-700">Estimated portion: {inr(estimatedTotal)}</p> : null}
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
            className="max-w-[48%] shrink-0 rounded-full bg-primary px-3 py-3.5 text-center text-sm font-bold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-60 sm:max-w-none sm:px-5"
          >
            {saving ? "Saving…" : submitLabel}
          </button>
        </div>
      </div>
    </form>
  );
}