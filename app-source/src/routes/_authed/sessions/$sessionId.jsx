import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, CalendarDays, Loader2, Mic, Plus, RefreshCw, Search, ShoppingBasket, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { BillUploader } from "@/components/shopping/BillUploader";
import { parseReceiptMoney } from "@/lib/receipt-money";
import { reviewEstimateItems } from "@/lib/estimate-review";
import { estimatePriceMemoryKey, findRememberedEstimatePrices, rememberEstimatePrices } from "@/lib/estimate-price-memory";
import { SHOPPING_CATEGORIES, groupShoppingItems, inferShoppingCategory, filterShoppingListItems, parseVoiceShoppingItems, findDuplicateShoppingNames, sortShoppingListItems, applyManualShoppingOrder } from "@/lib/shopping-categories";
import { PriceComparisonPanel } from "@/components/shopping/PriceComparisonPanel";
import { StyledConfirmModal } from "@/components/ui/styled-confirm-modal";
import { useStyledConfirm } from "@/components/ui/use-styled-confirm";

export const Route = createFileRoute("/_authed/sessions/$sessionId")({
  head: () => ({ meta: [{ title: "Shopping Trip · Shopping Hisab" }] }),
  component: SessionDetailPage,
});

const inr = (paise) => new Intl.NumberFormat("en-IN", {
  style: "currency", currency: "INR", maximumFractionDigits: 2,
}).format(Number(paise || 0) / 100);

const dateLabel = (value) => {
  if (!value) return "Date not set";
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
};

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
  const { confirmStyled, dialogElement: pendingConfirmDialog } = useStyledConfirm();
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [deleteTripDialogOpen, setDeleteTripDialogOpen] = useState(false);
  const [pendingTotalDifference, setPendingTotalDifference] = useState(null);
  const [activeStep, setActiveStep] = useState(1);
  const [expandedMetadataRows, setExpandedMetadataRows] = useState({});
  const [loading, setLoading] = useState(true);
  const [editingTrip, setEditingTrip] = useState(false);
  const [tripName, setTripName] = useState("");
  const [tripDate, setTripDate] = useState("");
  const [tripSaving, setTripSaving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [listName, setListName] = useState("My shopping list");
  const [rows, setRows] = useState([blankRow()]);
  const [voiceListening, setVoiceListening] = useState(false);
  const [inputMode, setInputMode] = useState("type");
  const [billForm, setBillForm] = useState({ shop_name: "", purchase_date: new Date().toISOString().slice(0, 10), receipt_number: "", bill_total: "" });
  const [billSaving, setBillSaving] = useState(false);
  const billRequestKeyRef = useRef(null);
  const estimateRequestKeyRef = useRef(null);
  const billLineRequestKeysRef = useRef({});
  const billLineDeleteRequestKeysRef = useRef({});
  const uploadedBillCreateKeyRef = useRef(null);
  const uploadedBillLinesKeyRef = useRef(null);
  const scannedSourceLinesKeyRef = useRef(null);
  const manualSourceLinesKeyRef = useRef(null);
  const scannedSourceListKeyRef = useRef(null);
  const manualSourceListKeyRef = useRef(null);
  const confirmationRequestKeyRef = useRef(null);
  const confirmationLockRef = useRef(false);
  const scannedListSaveLockRef = useRef(false);
  const manualListSaveLockRef = useRef(false);
  const manualBillSaveLockRef = useRef(false);
  const uploadedBillSaveLockRef = useRef(false);
  const billLineSaveLockRefs = useRef({});
  const billDeleteKeysRef = useRef({});
  const billLineDeleteKeysRef = useRef({});
  const [billLineForms, setBillLineForms] = useState({});
  const [billLineSaving, setBillLineSaving] = useState("");
  const [billLineDetails, setBillLineDetails] = useState({});
  const [billLineEditDrafts, setBillLineEditDrafts] = useState({});
  const [billLineEditSaving, setBillLineEditSaving] = useState("");
  const [estimatePrices, setEstimatePrices] = useState({});
  const [estimateSources, setEstimateSources] = useState({});
  const [rememberedEstimateKeys, setRememberedEstimateKeys] = useState({});
  const [estimateReviewWarnings, setEstimateReviewWarnings] = useState([]);
  const [estimateReviewOpen, setEstimateReviewOpen] = useState(false);
  const [estimateDetailsOpen, setEstimateDetailsOpen] = useState(false);
  const [estimateDetailItems, setEstimateDetailItems] = useState([]);
  const [estimateSaving, setEstimateSaving] = useState(false);
  const [aiEstimateSaving, setAiEstimateSaving] = useState(false);
  const [scannedDraft, setScannedDraft] = useState(null);
  const [scannedFileUri, setScannedFileUri] = useState("");
  const [scannedListName, setScannedListName] = useState("Scanned shopping list");
  const [scannedRows, setScannedRows] = useState([]);
  const [scannedListSaving, setScannedListSaving] = useState(false);
  const [confirmationTotal, setConfirmationTotal] = useState("");
  const [confirmationSaving, setConfirmationSaving] = useState(false);
  const [adjustFinalTotal, setAdjustFinalTotal] = useState(false);
  const [mergeTargets, setMergeTargets] = useState({});
  const [editingItemId, setEditingItemId] = useState("");
  const [itemEditDraft, setItemEditDraft] = useState({ product_name: "", planned_quantity: "", unit: "pcs", brand: "", pack_size: "", notes: "" });
  const [itemEditSaving, setItemEditSaving] = useState(false);
  const [undoItem, setUndoItem] = useState(null);
  const [undoSaving, setUndoSaving] = useState(false);
  const undoRestoreLockRef = useRef(false);
  const undoRestoreRequestKeyRef = useRef(null);
  const undoTimerRef = useRef(null);
  const [categoryOverrides, setCategoryOverrides] = useState(() => {
    if (typeof window === "undefined") return {};
    try { return JSON.parse(window.localStorage.getItem(`shopping-hisab-categories-${sessionId}`) || "{}"); }
    catch { return {}; }
  });
  const [smartListSearch, setSmartListSearch] = useState("");
  const [smartListFilter, setSmartListFilter] = useState("all");
  const [smartListSort, setSmartListSort] = useState("category");
  const [manualItemOrder, setManualItemOrder] = useState(() => { if (typeof window === "undefined") return []; try { const saved = JSON.parse(window.localStorage.getItem(`shopping-hisab-order-${sessionId}`) || "[]"); return Array.isArray(saved) ? saved : []; } catch { return []; } });

  const [uploadedBillDraft, setUploadedBillDraft] = useState(null);
  const [uploadedBillFileUri, setUploadedBillFileUri] = useState("");
  const [uploadedBillShop, setUploadedBillShop] = useState("");
  const [uploadedBillDate, setUploadedBillDate] = useState(new Date().toISOString().slice(0, 10));
  const [uploadedBillTotal, setUploadedBillTotal] = useState("");
  const [uploadedBillTotalSource, setUploadedBillTotalSource] = useState("manual");
  const [uploadedBillRows, setUploadedBillRows] = useState([]);
  const [uploadedBillSaving, setUploadedBillSaving] = useState(false);
  const [uploadedBillId, setUploadedBillId] = useState("");

  const loadSession = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api(`/api/shopping/sessions/${sessionId}`);
      setSession(data);
      return true;
    } catch (cause) {
      setError(cause.message || "Could not load this session.");
      return false;
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => { loadSession(); }, [loadSession]);
  useEffect(() => () => { if (undoTimerRef.current) clearTimeout(undoTimerRef.current); }, []);
  useEffect(() => { if (!undoItem) return; undoTimerRef.current = setTimeout(() => setUndoItem(null), 10000); return () => { if (undoTimerRef.current) clearTimeout(undoTimerRef.current); }; }, [undoItem]);
  useEffect(() => {
    try { window.localStorage.setItem(`shopping-hisab-categories-${sessionId}`, JSON.stringify(categoryOverrides)); }
    catch { /* category preferences are optional local-only enhancements */ }
  }, [categoryOverrides, sessionId]);

  useEffect(() => {
    if (session) setConfirmationTotal((Number(session.actual_total_paise || 0) / 100).toFixed(2));
  }, [session?.actual_total_paise]);
  useEffect(() => {
    if (!session) return;
    const validIds = new Set((session.items || []).map((item) => item.id));
    const pruneRemovedItems = (current) => {
      const entries = Object.entries(current).filter(([itemId]) => validIds.has(itemId));
      return entries.length === Object.keys(current).length ? current : Object.fromEntries(entries);
    };
    setEstimatePrices(pruneRemovedItems);
    setEstimateSources(pruneRemovedItems);
    setRememberedEstimateKeys(pruneRemovedItems);
  }, [session?.id, session?.items]);

  useEffect(() => {
    if (!session?.items?.length || typeof window === "undefined") return;
    const remembered = findRememberedEstimatePrices(session.items);
    const currentKeys = Object.fromEntries(session.items.map((item) => [item.id, estimatePriceMemoryKey(item)]));
    setEstimatePrices((current) => {
      const next = { ...current };
      const inserted = [];
      const staleRemembered = [];
      for (const itemId of Object.keys(next)) {
        if (estimateSources[itemId] === "remembered" && rememberedEstimateKeys[itemId] && rememberedEstimateKeys[itemId] !== currentKeys[itemId]) {
          delete next[itemId];
          staleRemembered.push(itemId);
        }
      }
      for (const [itemId, price] of Object.entries(remembered)) {
        if (next[itemId] == null || String(next[itemId]).trim() === "") {
          next[itemId] = price;
          inserted.push(itemId);
        }
      }
      if (inserted.length || staleRemembered.length) {
        setEstimateSources((sources) => {
          const updated = { ...sources };
          for (const itemId of inserted) if (!updated[itemId]) updated[itemId] = "remembered";
          for (const itemId of staleRemembered) delete updated[itemId];
          return updated;
        });
        setRememberedEstimateKeys((keys) => {
          const updated = { ...keys };
          for (const itemId of inserted) updated[itemId] = currentKeys[itemId];
          for (const itemId of staleRemembered) delete updated[itemId];
          return updated;
        });
      }
      return next;
    });
  }, [session?.id, session?.items]);

  useEffect(() => {
    if (!session) return;
    setTripName(session.name || "");
    setTripDate(session.shopping_date || "");
  }, [session?.id, session?.name, session?.shopping_date]);

  const saveTripDetails = async (event) => {
    event.preventDefault();
    if (!tripDate) return toast.error("Choose the shopping date.");
    setTripSaving(true);
    try {
      await api(`/api/shopping/sessions/${sessionId}`, {
        method: "PATCH",
        body: JSON.stringify({ name: tripName.trim(), shopping_date: tripDate }),
      });
      toast.success("Trip details updated.");
      setEditingTrip(false);
      await loadSession();
    } catch (cause) {
      toast.error(cause.message || "Could not update this trip.");
    } finally {
      setTripSaving(false);
    }
  };

  const deleteTrip = async () => { setDeleteTripDialogOpen(true); };

  const confirmDeleteTrip = async () => {
    setDeleteTripDialogOpen(false);
    try {
      await api(`/api/shopping/sessions/${sessionId}`, { method: "DELETE", headers: { "Idempotency-Key": crypto.randomUUID() } });
      toast.success("Shopping trip deleted.");
      navigate({ to: "/sessions" });
    } catch (cause) {
      toast.error(cause.message || "Could not delete this trip.");
      await loadSession();
    }
  };
  const updateRow = (index, key, value) => {
    setRows((current) => current.map((row, i) => i === index ? { ...row, [key]: value } : row));
  };

  const addRow = () => setRows((current) => [...current, blankRow()]);
  const startVoiceEntry = () => {
    const SpeechRecognitionApi = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
    if (!SpeechRecognitionApi) return toast.error("Voice input is not supported in this browser. Try Chrome or enter items manually.");
    const recognition = new SpeechRecognitionApi();
    recognition.lang = "en-IN";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onstart = () => setVoiceListening(true);
    recognition.onend = () => setVoiceListening(false);
    recognition.onerror = (event) => {
      setVoiceListening(false);
      toast.error(event.error === "not-allowed" ? "Microphone permission was denied." : "Voice input failed. Try again or enter items manually.");
    };
    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript || "";
      const parsedItems = parseVoiceShoppingItems(transcript);
      if (!parsedItems.length) return toast.info("No items recognized. Try saying: milk, eggs, rice.");
      setRows((current) => [...current.filter((row) => String(row.name || "").trim()), ...parsedItems.map((item) => ({ ...blankRow(), name: item.name, quantity: String(item.quantity), unit: item.unit }))]);
      setInputMode("type");
      setActiveStep(1);
      toast.success(`Added ${names.length} item(s) from voice. Review before saving.`);
    };
    try { recognition.start(); } catch { setVoiceListening(false); toast.error("Could not start voice input. Please try again."); }
  };
  const removeRow = (index) => setRows((current) => current.length === 1
    ? [blankRow()] : current.filter((_, i) => i !== index));

  const saveEstimate = async (event) => {
    event.preventDefault();
    const currentItems = session?.items || [];
    if (!currentItems.length) return toast.error("Add items to your list before estimating.");
    const invalidDetails = currentItems.filter((item) => {
      const quantity = Number(item.planned_quantity);
      return !Number.isFinite(quantity) || quantity <= 0 || !String(item.unit || "").trim();
    });
    if (invalidDetails.length) {
      setEstimateDetailItems(invalidDetails);
      setEstimateDetailsOpen(true);
      return;
    }
    const missing = currentItems.filter((item) => estimatePrices[item.id] == null || String(estimatePrices[item.id]).trim() === "");
    if (missing.length) return toast.error("Add a total line price for each item before saving your estimate.");
    const warnings = reviewEstimateItems(currentItems);
    if (warnings.length && !estimateReviewOpen) {
      setEstimateReviewWarnings(warnings);
      setEstimateReviewOpen(true);
      toast.warning("Review the quantity and pack-size warnings before saving.");
      return;
    }
    const lines = [];
    for (const item of currentItems) {
      const rupees = Number(estimatePrices[item.id]);
      if (!Number.isFinite(rupees) || rupees < 0 || !Number.isSafeInteger(Math.round(rupees * 100))) {
        return toast.error(`Enter a valid estimated price for ${item.product_name}.`);
      }
      const quantity = Number(item.planned_quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) return toast.error(`Enter a valid quantity for ${item.product_name}.`);
      const lineTotalPaise = Math.round(rupees * 100);
      const unitPrice = Math.round(lineTotalPaise / quantity);
      lines.push({
        shopping_item_id: item.id,
        quantity,
        unit: item.unit || "pcs",
        estimated_unit_price_paise: unitPrice,
        estimated_line_total_paise: lineTotalPaise,
        price_source: estimateSources[item.id] || "manual",
      });
    }
    setEstimateSaving(true);
    try {
      const sources = new Set(lines.map((line) => line.price_source));
      const calculationSource = sources.size > 1 ? "mixed" : (sources.values().next().value || "manual");
      const estimatePayload = { calculation_source: calculationSource, notes: calculationSource === "manual" ? "Manually entered by user" : "AI market estimates reviewed by user; manual entries retained where applicable", lines };
      const estimatePayloadText = JSON.stringify(estimatePayload);
      if (!estimateRequestKeyRef.current || estimateRequestKeyRef.current.payload !== estimatePayloadText) {
        estimateRequestKeyRef.current = { payload: estimatePayloadText, key: crypto.randomUUID() };
      }
      await api("/api/shopping/sessions/" + sessionId + "/estimates", {
        method: "POST",
        headers: { "Idempotency-Key": estimateRequestKeyRef.current.key },
        body: estimatePayloadText,
      });
      rememberEstimatePrices(currentItems, estimatePrices);
      if (!await loadSession()) {
        toast.warning("Estimate saved, but the trip did not refresh. Retry the same estimate to safely recover it.");
        return;
      }
      estimateRequestKeyRef.current = null;
      toast.success("Your estimate is saved.");
      setEstimateReviewOpen(false);
      setEstimateReviewWarnings([]);
    } catch (cause) {
      toast.error(cause.message || "Could not save this estimate.");
    } finally {
      setEstimateSaving(false);
    }
  };

  const generateAiEstimate = async () => {
    const currentItems = session?.items || [];
    if (!currentItems.length) return toast.error("Add items to your list before estimating.");
    setAiEstimateSaving(true);
    try {
      const result = await api("/api/ai", {
        method: "POST",
        body: JSON.stringify({
          action: "estimateMarketRates",
          data: { items: currentItems.map((item) => ({
            name: item.product_name,
            unit: item.unit || "pcs",
            brand: item.brand || "",
            packSize: item.pack_size || "",
            productType: item.product_type || "unsure",
          })) },
        }),
      });
      const rates = Array.isArray(result.rates) ? result.rates : [];
      const updates = {};
      const sources = {};
      for (const entry of rates) {
        const item = currentItems[entry.index];
        const rate = Number(entry.rate);
        if (!item || !Number.isFinite(rate) || rate <= 0) continue;
        const quantity = Number(item.planned_quantity);
        if (!Number.isFinite(quantity) || quantity <= 0) continue;
        updates[item.id] = String(Math.round(rate * quantity * 100) / 100);
        sources[item.id] = "ai_estimate";
      }
      if (!Object.keys(updates).length) {
        return toast.error("The AI could not produce reliable prices for these items. Enter local prices manually.");
      }
      setEstimatePrices((current) => ({ ...current, ...updates }));
      setEstimateSources((current) => ({ ...current, ...sources }));
      setRememberedEstimateKeys((current) => {
        const next = { ...current };
        for (const itemId of Object.keys(updates)) delete next[itemId];
        return next;
      });
      const missingCount = currentItems.length - Object.keys(updates).length;
      toast.success(`AI estimated ${Object.keys(updates).length} of ${currentItems.length} items. Review the prices${missingCount ? `; enter the remaining ${missingCount} manually` : ""} before saving.`);
    } catch (cause) {
      toast.error(cause.message || "AI estimation is temporarily unavailable.");
    } finally {
      setAiEstimateSaving(false);
    }
  };

  const startVoiceBillEntry = () => {
    const SpeechRecognitionApi = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionApi) return toast.error("Voice input is unavailable here. Use Type or Scan.");
    const recognition = new SpeechRecognitionApi();
    recognition.lang = "en-IN"; recognition.continuous = false; recognition.interimResults = false; recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const transcript = String(event.results?.[0]?.[0]?.transcript || "").trim(); if (!transcript) return;
      const match = transcript.match(/(?:rupees?|rs\\.?|₹)\\s*(\\d+(?:\\.\\d{1,2})?)|\\b(\\d+(?:\\.\\d{1,2})?)\\s*(?:rupees?|rs\\.?|₹)\\b/i);
      const amount = match ? (match[1] || match[2]) : "";
      const shop = amount ? transcript.replace(match[0], "").trim() : transcript;
      setBillForm((current) => ({ ...current, shop_name: shop || current.shop_name, bill_total: amount || current.bill_total }));
      toast.success(amount ? "Voice captured. Check shop and amount, then save as Unverified." : "Shop name captured. Enter the amount, then save as Unverified.");
    };
    recognition.onerror = () => toast.error("Voice capture failed. Try again or type instead.");
    try { recognition.start(); } catch { toast.error("Could not start voice capture."); }
  };
  const saveBill = async (event) => {
    event.preventDefault();
    const rupees = Number(billForm.bill_total);
    if (!Number.isFinite(rupees) || rupees < 0 || !Number.isSafeInteger(Math.round(rupees * 100))) {
      toast.error("Enter a valid bill total.");
      return;
    }
    if (manualBillSaveLockRef.current) return;
    manualBillSaveLockRef.current = true;
    setBillSaving(true);
    try {
      const billPayload = {
        shop_name: billForm.shop_name.trim(),
        purchase_date: billForm.purchase_date || null,
        receipt_number: billForm.receipt_number.trim(),
        bill_total_paise: Math.round(rupees * 100),
        bill_status: "needs_review",
        duplicate_fingerprint: [billForm.shop_name.trim().toLowerCase().replace(/\s+/g, " "), billForm.purchase_date, billForm.receipt_number.trim().toUpperCase(), Math.round(rupees * 100)].join("|").slice(0, 200),
        original_ocr: { entry_method: "manual" },
      };
      const billPayloadText = JSON.stringify(billPayload);
      if (!billRequestKeyRef.current || billRequestKeyRef.current.payload !== billPayloadText) {
        billRequestKeyRef.current = { payload: billPayloadText, key: crypto.randomUUID() };
      }
      const savedBill = await api(`/api/shopping/sessions/${sessionId}/bills`, {
        method: "POST",
        headers: { "Idempotency-Key": billRequestKeyRef.current.key },
        body: billPayloadText,
      });
      if (!await loadSession()) {
        toast.warning("Bill saved, but the trip did not refresh. Retry the same details to safely recover it.");
        return;
      }
      billRequestKeyRef.current = null;
      setBillForm({ shop_name: "", purchase_date: new Date().toISOString().slice(0, 10), receipt_number: "", bill_total: "" });
      if (savedBill.possible_duplicate) toast.warning("Possible duplicate bill detected. Review it before trusting the spending total.");
      else toast.success("Bill added to actual spending.");
    } catch (cause) {
      toast.error(cause.message || "Could not add this bill.");
    } finally {
      manualBillSaveLockRef.current = false;
      setBillSaving(false);
    }
  };
  const handleUploadedBill = (draft, fileUri) => {
    const extracted = Array.isArray(draft?.items) ? draft.items : [];
    if (!extracted.length) {
      toast.warning("No item rows were detected. You can still save the receipt and enter the shop total manually.");
    }
    const rows = extracted.map((item) => ({
      product_name: String(item?.name || ""),
      quantity: String(item?.qty ?? 1),
      unit: String(item?.unit || "pcs"),
      amount: (() => { const parsed = parseReceiptMoney(item?.amount); return parsed !== null && parsed > 0 ? parsed.toFixed(2) : ""; })(),
      shopping_item_id: "",
      original: item,
    }));
    const totals = draft?.totals && typeof draft.totals === "object" ? draft.totals : {};
    const rawGrandTotal = totals.grandTotal ?? draft?.grandTotal ?? draft?.grand_total ?? null;
    const parsedGrandTotal = parseReceiptMoney(rawGrandTotal);
    const hasPrintedTotal = parsedGrandTotal !== null;
    const everyRowHasAmount = rows.length > 0 && rows.every((row) =>
      row.amount.trim() !== "" && Number.isFinite(Number(row.amount)) && Number(row.amount) > 0
    );
    const itemLinesTotal = everyRowHasAmount
      ? rows.reduce((sum, row) => sum + Number(row.amount), 0)
      : null;

    setUploadedBillDraft(draft);
    setUploadedBillId("");
    setUploadedBillFileUri(fileUri || "");
    setUploadedBillShop(String(draft.shopName || ""));
    setUploadedBillDate(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(draft.date || "")) ? draft.date : new Date().toISOString().slice(0, 10));
    setUploadedBillTotal(hasPrintedTotal
      ? parsedGrandTotal.toFixed(2)
      : itemLinesTotal !== null ? itemLinesTotal.toFixed(2) : "");
    setUploadedBillTotalSource(hasPrintedTotal ? "receipt" : itemLinesTotal !== null ? "items" : "manual");
    setUploadedBillRows(rows);
  };

  const updateUploadedBillRow = (index, key, value) => setUploadedBillRows((current) =>
    current.map((row, i) => i === index ? { ...row, [key]: value } : row));

  useEffect(() => {
    if (uploadedBillTotalSource !== "items") return;
    const complete = uploadedBillRows.length > 0 && uploadedBillRows.every((row) =>
      row.amount.trim() !== "" && Number.isFinite(Number(row.amount)) && Number(row.amount) > 0
    );
    if (!complete) {
      setUploadedBillTotal("");
      setUploadedBillTotalSource("manual");
      return;
    }
    const lineTotal = uploadedBillRows.reduce((sum, row) => sum + Number(row.amount), 0);
    setUploadedBillTotal(lineTotal.toFixed(2));
  }, [uploadedBillRows, uploadedBillTotalSource]);

  const saveUploadedBill = async (event) => {
    event.preventDefault();
    const totalRupees = Number(uploadedBillTotal);
    if (!Number.isFinite(totalRupees) || totalRupees < 0 || !Number.isSafeInteger(Math.round(totalRupees * 100))) {
      return toast.error("Enter the total paid exactly as shown on the bill.");
    }
    const lines = uploadedBillRows.map((row) => ({
      ...row,
      product_name: row.product_name.trim(),
      quantity: Number(row.quantity),
      unit: row.unit.trim() || "pcs",
      amountRupees: row.amount.trim() === "" ? null : Number(row.amount),
    }));
    if (lines.some((line) => !line.product_name)) return toast.error("Check every extracted bill item name.");
    if (lines.some((line) => !Number.isFinite(line.quantity) || line.quantity < 0)) return toast.error("Check every extracted quantity.");
    if (lines.some((line) => line.amountRupees !== null && (!Number.isFinite(line.amountRupees) || line.amountRupees < 0))) return toast.error("Check every extracted item amount.");
    if (uploadedBillSaveLockRef.current) return;
    uploadedBillSaveLockRef.current = true;
    setUploadedBillSaving(true);
    try {
      let billId = uploadedBillId;
      if (!billId) {
        const fileMatch = /^cf-file:([a-f0-9-]{36})$/i.exec(uploadedBillFileUri);
        const shopKey = uploadedBillShop.trim().toLowerCase().replace(/\s+/g, " ");
        const duplicateFingerprint = [shopKey, uploadedBillDate, Math.round(totalRupees * 100)].join("|").slice(0, 200);
        const bill = await api(`/api/shopping/sessions/${sessionId}/bills`, {
          method: "POST",
          headers: { "Idempotency-Key": uploadedBillCreateKeyRef.current || (uploadedBillCreateKeyRef.current = crypto.randomUUID()) },
          body: JSON.stringify({
            shop_name: uploadedBillShop.trim(),
            purchase_date: uploadedBillDate || null,
            bill_total_paise: Math.round(totalRupees * 100),
            file_id: fileMatch?.[1] || null,
            original_file_uri: uploadedBillFileUri || null,
            duplicate_fingerprint: duplicateFingerprint,
            bill_status: fileMatch ? "verified" : "needs_review",
            original_ocr: { entry_method: "existing_bill_uploader", draft: uploadedBillDraft },
          }),
        });
        billId = bill.id;
        setUploadedBillId(billId);
      } else {
        await api(`/api/shopping/sessions/${sessionId}/bills/${billId}`, {
          method: "PATCH",
          body: JSON.stringify({
            shop_name: uploadedBillShop.trim(),
            purchase_date: uploadedBillDate || null,
            bill_total_paise: Math.round(totalRupees * 100),
          }),
        });
      }
      if (lines.length) {
        await api(`/api/shopping/sessions/${sessionId}/bills/${billId}/lines`, {
          method: "POST",
          headers: { "Idempotency-Key": uploadedBillLinesKeyRef.current || (uploadedBillLinesKeyRef.current = (() => { const fileMatch = /^cf-file:([a-f0-9-]{36})$/i.exec(uploadedBillFileUri); return fileMatch ? `uploaded-file-lines:${fileMatch[1]}` : crypto.randomUUID(); })()) },
          body: JSON.stringify({ lines: lines.map((line) => ({
            product_name: line.product_name,
            quantity: line.quantity,
            unit: line.unit,
            line_amount_paise: line.amountRupees === null ? null : Math.round(line.amountRupees * 100),
            shopping_item_id: line.shopping_item_id || null,
            is_extra: !line.shopping_item_id,
            match_method: line.shopping_item_id ? "confirmed" : "extra",
            original_ocr: line.original || {},
          })) }),
        });
      }
      if (!await loadSession()) {
        toast.warning("Receipt saved, but the trip did not refresh. Retry the same receipt to safely recover it.");
        return;
      }
      uploadedBillCreateKeyRef.current = null;
      uploadedBillLinesKeyRef.current = null;
      setUploadedBillDraft(null);
      setUploadedBillId("");
      setUploadedBillFileUri("");
      setUploadedBillRows([]);
      setUploadedBillTotal("");
      setUploadedBillTotalSource("manual");
      setUploadedBillShop("");
      toast.success(lines.length
        ? "Receipt and reviewed item details saved. The bill total is counted once."
        : "Receipt and total saved. You can add item details later.");
    } catch (cause) {
      toast.error(cause.message || "Could not save the uploaded bill.");
    } finally {
      uploadedBillSaveLockRef.current = false;
      setUploadedBillSaving(false);
    }
  };

  const updateBillLine = (billId, key, value) => setBillLineForms((current) => ({
    ...current,
    [billId]: { product_name: "", quantity: "1", unit: "pcs", amount: "", shopping_item_id: "", ...(current[billId] || {}), [key]: value },
  }));

  const saveBillLine = async (event, billId) => {
    event.preventDefault();
    const line = { product_name: "", quantity: "1", unit: "pcs", amount: "", shopping_item_id: "", ...(billLineForms[billId] || {}) };
    const quantity = Number(line.quantity);
    const amountRupees = line.amount.trim() === "" ? null : Number(line.amount);
    if (!line.product_name.trim()) return toast.error("Enter the bill item name.");
    if (!Number.isFinite(quantity) || quantity < 0) return toast.error("Enter a valid item quantity.");
    if (amountRupees !== null && (!Number.isFinite(amountRupees) || amountRupees < 0 || !Number.isSafeInteger(Math.round(amountRupees * 100)))) return toast.error("Enter a valid item amount.");
    if (billLineSaveLockRefs.current[billId]) return;
    billLineSaveLockRefs.current[billId] = true;
    setBillLineSaving(billId);
    try {
      await api(`/api/shopping/sessions/${sessionId}/bills/${billId}/lines`, {
        method: "POST",
        headers: { "Idempotency-Key": billLineRequestKeysRef.current[billId] || (billLineRequestKeysRef.current[billId] = crypto.randomUUID()) },
        body: JSON.stringify({ lines: [{
          product_name: line.product_name.trim(),
          quantity,
          unit: line.unit.trim() || "pcs",
          line_amount_paise: amountRupees === null ? null : Math.round(amountRupees * 100),
          shopping_item_id: line.shopping_item_id || null,
          is_extra: !line.shopping_item_id,
          match_method: line.shopping_item_id ? "confirmed" : "extra",
          original_ocr: { entry_method: "manual" },
        }] }),
      });
      const details = await api(`/api/shopping/sessions/${sessionId}/bills/${billId}`);
      setBillLineDetails((current) => ({ ...current, [billId]: details.purchase_lines || [] }));
      delete billLineRequestKeysRef.current[billId];
      setBillLineForms((current) => ({ ...current, [billId]: { product_name: "", quantity: "1", unit: "pcs", amount: "", shopping_item_id: "" } }));
      toast.success("Bill item added. Bill total remains the actual spending amount.");
    } catch (cause) {
      toast.error(cause.message || "Could not add this bill item.");
    } finally {
      delete billLineSaveLockRefs.current[billId];
      setBillLineSaving("");
    }
  };

  const updateBillStatus = async (billId, billStatus) => {
    try {
      await api(`/api/shopping/sessions/${sessionId}/bills/${billId}`, {
        method: "PATCH",
        body: JSON.stringify({ bill_status: billStatus }),
      });
      toast.success(billStatus === "duplicate" || billStatus === "void"
        ? "Bill excluded from actual spending."
        : "Bill status updated.");
      await loadSession();
    } catch (cause) {
      toast.error(cause.message || "Could not update bill status.");
    }
  };

  const mergePlannedItem = async (sourceItemId) => {
    const targetItemId = mergeTargets[sourceItemId];
    if (!targetItemId) return toast.error("Choose which planned item to merge into.");
    try {
      await api(`/api/shopping/sessions/${sessionId}/items/${sourceItemId}/merge`, {
        method: "POST",
        body: JSON.stringify({ target_item_id: targetItemId }),
      });
      toast.success("Items merged. Original source records are preserved.");
      setMergeTargets((current) => ({ ...current, [sourceItemId]: "" }));
      await loadSession();
    } catch (cause) {
      toast.error(cause.message || "Could not merge these items.");
    }
  };

  const confirmSession = async (event) => {
    event.preventDefault();
    const rupees = Number(confirmationTotal);
    if (!Number.isFinite(rupees) || rupees < 0 || !Number.isSafeInteger(Math.round(rupees * 100))) return toast.error("Enter a valid final expense amount.");
    if (Number(session?.bills_amount_pending || 0) > 0) return toast.error("Resolve every bill with a pending amount before completing this session.");
    if (Math.round(rupees * 100) <= 0) return toast.error("A shopping trip cannot be completed with ₹0.00. Enter the actual paid amount or review your bills.");
    const calculatedRupees = Number(session?.actual_total_paise || 0) / 100;
    if (Math.round(rupees * 100) !== Math.round(calculatedRupees * 100)) {
      setPendingTotalDifference({ rupees, calculatedRupees, difference: rupees - calculatedRupees });
      return;
    }
    return finishSession(rupees);
  };

  const finishSession = async (rupees) => {
    setPendingTotalDifference(null);
    if (confirmationLockRef.current) return;
    confirmationLockRef.current = true;
    setConfirmationSaving(true);
    try {
      const result = await api(`/api/shopping/sessions/${sessionId}/confirm`, {
        method: "POST",
        headers: { "Idempotency-Key": confirmationRequestKeyRef.current || (confirmationRequestKeyRef.current = crypto.randomUUID()) },
        body: JSON.stringify({ confirmed_total_paise: Math.round(rupees * 100) }),
      });
      if (!await loadSession()) {
        toast.warning(`Shopping trip completed (confirmation v${result.revision_number}), but the trip did not refresh. Retry the same total to safely recover it.`);
        return;
      }
      confirmationRequestKeyRef.current = null;
      toast.success(`Shopping trip completed. Confirmation v${result.revision_number} saved.`);
    } catch (cause) {
      toast.error(cause.message || "Could not complete this session.");
    } finally {
      confirmationLockRef.current = false;
      setConfirmationSaving(false);
    }
  };
  const moveListItem = (categoryItems, item, direction) => {
    const currentIds = categoryItems.map((entry) => entry.id);
    const currentIndex = currentIds.indexOf(item.id);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= currentIds.length) return;
    const orderedIds = [...manualItemOrder];
    categoryItems.forEach((entry) => { if (!orderedIds.includes(entry.id)) orderedIds.push(entry.id); });
    const currentPosition = orderedIds.indexOf(item.id);
    const neighborPosition = orderedIds.indexOf(currentIds[nextIndex]);
    if (currentPosition >= 0 && neighborPosition >= 0) [orderedIds[currentPosition], orderedIds[neighborPosition]] = [orderedIds[neighborPosition], orderedIds[currentPosition]];
    setManualItemOrder(orderedIds);
    try { window.localStorage.setItem(`shopping-hisab-order-${sessionId}`, JSON.stringify(orderedIds)); } catch { /* Local reorder persistence is best-effort. */ }
    setSmartListSort("manual");
  };
  const beginItemEdit = (item) => {
    setEditingItemId(item.id);
    setItemEditDraft({ product_name: item.product_name || "", planned_quantity: String(item.planned_quantity ?? ""), unit: item.unit || "pcs", brand: item.brand || "", pack_size: item.pack_size || "", notes: item.notes || "" });
  };
  const saveItemEdit = async (event) => {
    event.preventDefault();
    const quantity = Number(itemEditDraft.planned_quantity);
    if (!itemEditDraft.product_name.trim()) return toast.error("Enter an item name.");
    if (!Number.isFinite(quantity) || quantity < 0) return toast.error("Enter a valid quantity.");
    setItemEditSaving(true);
    try {
      await api(`/api/shopping/sessions/${sessionId}/items/${editingItemId}`, { method: "PATCH", body: JSON.stringify({ product_name: itemEditDraft.product_name.trim(), planned_quantity: quantity, unit: itemEditDraft.unit.trim() || "pcs", brand: itemEditDraft.brand.trim(), pack_size: itemEditDraft.pack_size.trim(), notes: itemEditDraft.notes.trim() }) });
      setEditingItemId("");
      toast.success("Item updated.");
      await loadSession();
    } catch (cause) { toast.error(cause.message || "Could not update item."); }
    finally { setItemEditSaving(false); }
  };
  const deletePlannedItem = async (item) => {
    if (!await confirmStyled(`Remove "${item.product_name}" from this shopping session?`)) return;
    try {
      await api(`/api/shopping/sessions/${sessionId}/items/${item.id}`, { method: "DELETE" });
      setEstimatePrices((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      setEstimateSources((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      await loadSession();
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
      setUndoItem({ ...item });
      toast.success("Planned item removed. Undo is available for 10 seconds.");
    } catch (cause) {
      toast.error(cause.message || "Could not remove this planned item.");
    }
  };

  const undoPlannedItem = async () => {
    if (!undoItem || undoRestoreLockRef.current) return;
    undoRestoreLockRef.current = true;
    setUndoSaving(true);
    try {
      const restorePayload = { product_name: undoItem.product_name, planned_quantity: Number(undoItem.planned_quantity || 0), unit: undoItem.unit || "pcs", brand: undoItem.brand || "", pack_size: undoItem.pack_size || "", product_type: undoItem.product_type || "unsure", notes: undoItem.notes || "" };
      const restorePayloadText = JSON.stringify(restorePayload);
      if (!undoRestoreRequestKeyRef.current || undoRestoreRequestKeyRef.current.payload !== restorePayloadText) {
        undoRestoreRequestKeyRef.current = { payload: restorePayloadText, key: crypto.randomUUID() };
      }
      await api(`/api/shopping/sessions/${sessionId}/items`, { method: "POST", headers: { "Idempotency-Key": undoRestoreRequestKeyRef.current.key }, body: restorePayloadText });
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
      if (!await loadSession()) {
        toast.warning("Item restored, but the list refresh failed. Retry Undo to safely recover the result.");
        return;
      }
      undoRestoreRequestKeyRef.current = null;
      setUndoItem(null);
      toast.success("Item restored.");
    } catch (cause) { toast.error(cause.message || "Could not restore item."); }
    finally { undoRestoreLockRef.current = false; setUndoSaving(false); }
  };
  const loadBillLines = async (billId) => {
    try {
      const details = await api(`/api/shopping/sessions/${sessionId}/bills/${billId}`);
      setBillLineDetails((current) => ({ ...current, [billId]: details.purchase_lines || [] }));
    } catch (cause) {
      toast.error(cause.message || "Could not load bill items.");
    }
  };

  const deleteBill = async (billId) => {
    if (!await confirmStyled("Delete this bill and its saved bill items? The trip total will be recalculated. The uploaded file is retained.")) return;
    const requestKey = billDeleteKeysRef.current[billId] || (billDeleteKeysRef.current[billId] = crypto.randomUUID());
    try {
      await api(`/api/shopping/sessions/${sessionId}/bills/${billId}`, {
        method: "DELETE",
        headers: { "Idempotency-Key": requestKey },
      });
      setBillLineDetails((current) => { const next = { ...current }; delete next[billId]; return next; });
      if (!await loadSession()) {
        toast.warning("Bill deleted, but the trip did not refresh. Retry the deletion to safely recover it.");
        return;
      }
      delete billDeleteKeysRef.current[billId];
      toast.success("Bill deleted. Trip totals recalculated.");
    } catch (cause) {
      toast.error(cause.message || "Could not delete this bill.");
      await loadSession();
    }
  };

  const editBillLine = (billId, line) => setBillLineEditDrafts((current) => ({
    ...current, [line.id]: { product_name: line.product_name, quantity: String(line.quantity), amount: line.line_amount_paise == null ? "" : (Number(line.line_amount_paise) / 100).toFixed(2) }
  }));

  const saveBillLineEdit = async (billId, lineId) => {
    const draft = billLineEditDrafts[lineId];
    if (!draft) return;
    const quantity = Number(draft.quantity);
    const amount = draft.amount.trim() === "" ? null : Number(draft.amount);
    if (!draft.product_name.trim()) return toast.error("Bill item name is required.");
    if (!Number.isFinite(quantity) || quantity < 0) return toast.error("Enter a valid quantity.");
    if (amount !== null && (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(Math.round(amount * 100)))) return toast.error("Enter a valid line amount.");
    setBillLineEditSaving(lineId);
    try {
      const updated = await api(`/api/shopping/sessions/${sessionId}/bills/${billId}/lines/${lineId}`, {
        method: "PATCH",
        body: JSON.stringify({ product_name: draft.product_name.trim(), quantity, line_amount_paise: amount === null ? null : Math.round(amount * 100) }),
      });
      setBillLineDetails((current) => ({ ...current, [billId]: (current[billId] || []).map((line) => line.id === lineId ? updated : line) }));
      setBillLineEditDrafts((current) => { const next = { ...current }; delete next[lineId]; return next; });
      await loadSession();
      toast.success("Bill item updated; reconciliation refreshed.");
    } catch (cause) { toast.error(cause.message || "Could not update bill item."); }
    finally { setBillLineEditSaving(""); }
  };

  const deleteBillLine = async (billId, lineId) => {
    if (!await confirmStyled("Delete this bill item? The bill reconciliation will be recalculated.")) return;
    const requestKey = billLineDeleteRequestKeysRef.current[lineId] || (billLineDeleteRequestKeysRef.current[lineId] = crypto.randomUUID());
    try {
      await api(`/api/shopping/sessions/${sessionId}/bills/${billId}/lines/${lineId}`, { method: "DELETE", headers: { "Idempotency-Key": requestKey } });
      setBillLineDetails((current) => ({ ...current, [billId]: (current[billId] || []).filter((line) => line.id !== lineId) }));
      if (!await loadSession()) {
        toast.warning("Bill item deleted, but the trip did not refresh. Retry the deletion to safely recover it.");
        return;
      }
      delete billLineDeleteRequestKeysRef.current[lineId];
      toast.success("Bill item deleted and reconciliation updated.");
    } catch (cause) {
      toast.error(cause.message || "Could not delete this bill item.");
    }
  };

  const handleScannedList = (draft, fileUri) => {
    const draftItems = Array.isArray(draft?.items) ? draft.items : [];
    if (!draftItems.length) {
      toast.error("No list items were detected. You can enter the list manually.");
      return;
    }
    setScannedDraft(draft);
    setScannedFileUri(fileUri || "");
    setScannedListName(draft.shopName || "Scanned shopping list");
    setScannedRows(draftItems.map((item) => ({
      name: String(item?.name || ""),
      quantity: String(item?.qty ?? 1),
      unit: String(item?.unit || "pcs"),
      original: item,
    })));
  };

  const updateScannedRow = (index, key, value) => setScannedRows((current) =>
    current.map((row, i) => i === index ? { ...row, [key]: value } : row));

  const saveScannedList = async (event) => {
    event.preventDefault();
    const validRows = scannedRows.map((row) => ({ ...row, name: row.name.trim(), quantity: Number(row.quantity), unit: row.unit.trim() || "pcs" }));
    if (!validRows.length || validRows.some((row) => !row.name)) return toast.error("Check every scanned item name before saving.");
    if (validRows.some((row) => !Number.isFinite(row.quantity) || row.quantity < 0)) return toast.error("Check the quantity for each scanned item.");
    const scannedDuplicates = findDuplicateShoppingNames(items, validRows.map((row) => row.name));
    if (scannedDuplicates.length && !await confirmStyled(`Similar items already exist or repeat in this scanned list: ${scannedDuplicates.join(", ")}. Keep them as separate entries?`)) return;
    if (scannedListSaveLockRef.current) return;
    scannedListSaveLockRef.current = true;
    setScannedListSaving(true);
    try {
      const fileMatch = /^cf-file:([a-f0-9-]{36})$/i.exec(scannedFileUri);
      const sourceList = await api(`/api/shopping/sessions/${sessionId}/lists`, {
        method: "POST",
        headers: { "Idempotency-Key": scannedSourceListKeyRef.current || (scannedSourceListKeyRef.current = crypto.randomUUID()) },
        body: JSON.stringify({
          source_type: "handwritten_scan",
          file_id: fileMatch?.[1] || null,
          original_file_uri: scannedFileUri || null,
          source_metadata: { title: scannedListName.trim() || "Scanned shopping list", import_method: "existing_bill_uploader" },
        }),
      });
      const lineResult = await api(`/api/shopping/sessions/${sessionId}/lists/${sourceList.id}/lines`, {
        method: "POST",
        headers: { "Idempotency-Key": scannedSourceLinesKeyRef.current || (scannedSourceLinesKeyRef.current = crypto.randomUUID()) },
        body: JSON.stringify({ lines: validRows.map((row, index) => ({
          line_number: index + 1,
          original_name: String(row.original?.name || row.name),
          recognized_name: row.name,
          quantity: row.quantity,
          unit: row.unit,
          original_ocr: row.original || {},
        })) }),
      });
      for (let index = 0; index < validRows.length; index++) {
        const row = validRows[index];
        await api(`/api/shopping/sessions/${sessionId}/items`, {
          method: "POST",
          body: JSON.stringify({
            product_name: row.name,
            planned_quantity: row.quantity,
            unit: row.unit,
            source_line_id: lineResult.line_ids[index],
          }),
        });
      }
      if (!await loadSession()) {
        toast.warning("Scanned list saved, but the trip did not refresh. Retry the same list to safely recover it.");
        return;
      }
      scannedSourceListKeyRef.current = null;
      scannedSourceLinesKeyRef.current = null;
      setScannedDraft(null);
      setScannedFileUri("");
      setScannedRows([]);
      toast.success(`${validRows.length} scanned ${validRows.length === 1 ? "item" : "items"} added after review.`);
    } catch (cause) {
      toast.error(cause.message || "Could not save the scanned list.");
      await loadSession();
    } finally {
      scannedListSaveLockRef.current = false;
      setScannedListSaving(false);
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

    const duplicateNames = findDuplicateShoppingNames(items, validRows.map((row) => row.name));
    if (duplicateNames.length && !await confirmStyled(`Similar items already exist or repeat in this list: ${duplicateNames.join(", ")}. Keep them as separate entries?`)) return;
    if (manualListSaveLockRef.current) return;
    manualListSaveLockRef.current = true;
    setSaving(true);
    try {
      const sourceList = await api(`/api/shopping/sessions/${sessionId}/lists`, {
        method: "POST",
        headers: { "Idempotency-Key": manualSourceListKeyRef.current || (manualSourceListKeyRef.current = crypto.randomUUID()) },
        body: JSON.stringify({
          source_type: "manual_entry",
          source_metadata: { title: listName.trim() || "Manual shopping list" },
        }),
      });
      const lineResult = await api(`/api/shopping/sessions/${sessionId}/lists/${sourceList.id}/lines`, {
        method: "POST",
        headers: { "Idempotency-Key": manualSourceLinesKeyRef.current || (manualSourceLinesKeyRef.current = crypto.randomUUID()) },
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
      if (!await loadSession()) {
        toast.warning("Shopping list saved, but the trip did not refresh. Retry the same list to safely recover it.");
        return;
      }
      manualSourceListKeyRef.current = null;
      manualSourceLinesKeyRef.current = null;
      setListName("My shopping list");
      setRows([blankRow()]);
      toast.success(`${validRows.length} ${validRows.length === 1 ? "item" : "items"} added`);
    } catch (cause) {
      toast.error(cause.message || "Could not save this list.");
      await loadSession();
    } finally {
      manualListSaveLockRef.current = false;
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="space-y-3"><div className="h-8 w-2/3 animate-pulse rounded bg-muted" /><div className="h-36 animate-pulse rounded-[24px] bg-muted" /><div className="h-56 animate-pulse rounded-[24px] bg-muted" /></div>;
  }

  if (error || !session) {
    return <div className="rounded-[22px] border border-border px-5 py-8 text-center">
      <p className="text-sm font-bold">{error || "Shopping trip not found."}</p>
      <button type="button" onClick={loadSession} className="mt-3 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground">Try again</button>
      <Link to="/sessions" className="mt-3 block text-sm underline">Back to sessions</Link>
    </div>;
  }

  const items = session.items || [];
  const smartListItems = filterShoppingListItems(items, smartListSearch, smartListFilter);
  const smartSortedItems = smartListSort === "manual" ? applyManualShoppingOrder(smartListItems, manualItemOrder) : sortShoppingListItems(smartListItems, smartListSort);
  const smartListGroups = groupShoppingItems(smartSortedItems, categoryOverrides);

  const lists = session.source_lists || [];
  const listLineLookup = new Map();
  for (const list of lists) {
    const sourceLines = Array.isArray(list.lines) ? list.lines : Array.isArray(list.source_lines) ? list.source_lines : [];
    for (const line of sourceLines) {
      if (line?.id != null) listLineLookup.set(String(line.id), String(list.id));
    }
  }
  const groupedSourceLists = lists.map((list) => ({
    ...list,
    groupedItems: items.filter((item) => listLineLookup.get(String(item.source_line_id || "")) === String(list.id)),
  })).filter((list) => list.groupedItems.length);
  const groupedItemIds = new Set(groupedSourceLists.flatMap((list) => list.groupedItems.map((item) => String(item.id))));
  const fallbackItems = items.filter((item) => !groupedItemIds.has(String(item.id)));
  const completed = session.status === "completed";
  const unresolvedBills = (session.bills || []).filter(
    (bill) => !["verified", "duplicate", "void"].includes(bill.bill_status),
  );
  const latestEstimate = (session.estimates || [])[0] || null;
    const fullyPurchasedItemCount = items.filter((item) =>
    Number(item.remaining_quantity ?? item.planned_quantity) <= 0
  ).length;
  const shoppingProgress = items.length ? Math.round((fullyPurchasedItemCount / items.length) * 100) : 0;
  const estimateDifference = latestEstimate ? Number(session.actual_total_paise || 0) - Number(latestEstimate.estimated_total_paise || 0) : null;
  const pricedEstimateItems = items.filter((item) => {
    const value = estimatePrices[item.id];
    return value != null && String(value).trim() !== "" && Number.isFinite(Number(value)) && Number(value) >= 0;
  });
  const draftEstimateRupees = pricedEstimateItems.reduce(
    (total, item) => total + Number(estimatePrices[item.id]),
    0,
  );
  const uploadedBillRowsHaveAmounts = uploadedBillRows.length > 0 && uploadedBillRows.every((row) =>
    row.amount.trim() !== "" && Number.isFinite(Number(row.amount)) && Number(row.amount) >= 0
  );
  const uploadedBillLinesTotal = uploadedBillRowsHaveAmounts
    ? uploadedBillRows.reduce((total, row) => total + Number(row.amount), 0)
    : null;

  return (
    <div className="pb-44 scroll-mt-20">
      <Link to="/sessions" className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground">
        <ArrowLeft className="h-4 w-4" /> All trips
      </Link>

      <div className="rounded-[24px] bg-primary p-5 text-primary-foreground">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wider text-white/65">Shopping trip</p>
            <h1 className="mt-1 break-words text-[22px] font-extrabold leading-tight">{session.name || "Shopping trip"}</h1>
            <p className="mt-2 flex items-center gap-1.5 text-[12px] text-white/75"><CalendarDays className="h-3.5 w-3.5" />{dateLabel(session.shopping_date)}</p>
          </div>
          <span className="shrink-0 rounded-full bg-white/15 px-3 py-1.5 text-[10.5px] font-bold">{completed ? "Finished" : "In progress"}</span>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 border-t border-white/15 pt-4">
          <div><p className="text-[11px] text-white/65">Paid so far</p><p className="mt-1 text-[20px] font-extrabold tabular-nums">{inr(session.actual_total_paise)}</p></div>
          <div><p className="text-[11px] text-white/65">Bills to check</p><p className="mt-1 text-[20px] font-extrabold tabular-nums">{Number(session.bills_amount_pending || 0)}</p></div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setEditingTrip((value) => !value)}
          className="rounded-full border border-border bg-white px-3.5 py-2 text-[11.5px] font-bold text-primary">
          {editingTrip ? "Close trip editor" : "Edit trip details"}
        </button>
        <button type="button" onClick={deleteTrip}
          className="rounded-full border border-destructive/30 bg-white px-3.5 py-2 text-[11.5px] font-bold text-destructive">
          Delete trip
        </button>
      </div>
      {editingTrip && !completed ? (
        <form onSubmit={saveTripDetails} className="mt-3 space-y-3 rounded-[22px] border border-border bg-white p-4">
          <div>
            <label htmlFor="edit-trip-name" className="mb-1.5 block text-[11.5px] font-bold text-muted-foreground">Trip name</label>
            <input id="edit-trip-name" value={tripName} onChange={(event) => setTripName(event.target.value)}
              maxLength={120} placeholder="e.g. Monthly groceries"
              className="h-11 w-full rounded-xl border border-border bg-background px-3 text-[13px]" />
          </div>
          <div>
            <label htmlFor="edit-trip-date" className="mb-1.5 block text-[11.5px] font-bold text-muted-foreground">Shopping date</label>
            <input id="edit-trip-date" type="date" required value={tripDate} onChange={(event) => setTripDate(event.target.value)}
              className="h-11 w-full rounded-xl border border-border bg-background px-3 text-[13px]" />
          </div>
          <button type="submit" disabled={tripSaving}
            className="w-full rounded-full bg-primary py-3 text-[12.5px] font-bold text-primary-foreground disabled:opacity-60">
            {tripSaving ? "Saving changes…" : "Save trip details"}
          </button>
        </form>
      ) : null}

      <nav aria-label="Shopping trip steps" className="mt-3 grid grid-cols-4 gap-1 rounded-[20px] border border-[#3B0A0A] bg-white p-2 shadow-sm">
        {[
          { id: 1, label: "Input & Lists", done: items.length > 0 },
          { id: 2, label: "Review List", done: items.length > 0 },
          { id: 3, label: "AI Estimate", done: Boolean(latestEstimate) },
          { id: 4, label: "Shop & Finish", done: completed },
        ].map((step) => (
          <button key={step.id} type="button" onClick={() => setActiveStep(step.id)} aria-current={activeStep === step.id ? "step" : undefined}
            className={`flex min-h-[62px] flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-[10px] font-bold transition-colors ${activeStep === step.id ? "bg-[#EA580C] text-white shadow-sm" : step.done ? "bg-[#0F766E]/10 text-[#0F766E]" : "bg-secondary/40 text-muted-foreground"}`}>
            <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] ${activeStep === step.id ? "bg-white/20" : step.done ? "bg-[#0F766E]/15" : "bg-secondary"}`}>{step.id}</span>
            {step.label}
          </button>
        ))}
      </nav>

      {activeStep === 1 && !completed ? (
        <section className="mb-3 grid grid-cols-3 gap-2" aria-label="Choose how to add items">
          <button type="button" onClick={() => setInputMode("scan")} className="min-h-[92px] rounded-2xl border border-[#3B0A0A] bg-white p-3 text-left shadow-sm">
            <span className="block text-[12px] font-extrabold">Scan</span><span className="mt-1 block text-[10.5px] text-muted-foreground">Photo / PDF list</span>
          </button>
          <button type="button" onClick={() => setInputMode("type")} className="min-h-[92px] rounded-2xl border border-[#3B0A0A] bg-white p-3 text-left shadow-sm">
            <span className="block text-[12px] font-extrabold">Type</span><span className="mt-1 block text-[10.5px] text-muted-foreground">Enter items</span>
          </button>
          <button type="button" onClick={() => { setInputMode("voice"); startVoiceEntry(); }} disabled={voiceListening} className="min-h-[92px] rounded-2xl border border-[#3B0A0A] bg-white p-3 text-left shadow-sm disabled:opacity-60">
            <span className="block text-[12px] font-extrabold">Voice</span><span className="mt-1 block text-[10.5px] text-muted-foreground">{voiceListening ? "Listening…" : "Speak items"}</span>
          </button>
        </section>
      ) : null}

      {!completed ? (
        <section hidden={activeStep !== 1 || inputMode !== "scan"} id="trip-scan-input" className="mb-4 space-y-3 rounded-[24px] border border-[#3B0A0A] bg-white p-4 shadow-sm">
          <div>
            <p className="text-[15px] font-extrabold">Scan handwritten list</p>
            <p className="mt-1 text-[12px] text-muted-foreground">Take a photo or choose a gallery image or PDF. Review detected items and quantities before adding.</p>
          </div>
          <BillUploader purpose="shopping_list" compact onExtracted={handleScannedList} />
                  {scannedDraft ? (
                    <form onSubmit={saveScannedList} className="mt-3 space-y-3 rounded-[24px] border border-primary/25 bg-white p-4">
                      <div>
                        <p className="text-[15px] font-extrabold">Review scanned list</p>
                        <p className="mt-1 text-[12px] text-muted-foreground">Nothing is added until you save. Original scan data is retained with the source list.</p>
                      </div>
                      <input value={scannedListName} onChange={(event) => setScannedListName(event.target.value)} maxLength={120} aria-label="Scanned list name" className="h-10 w-full rounded-xl border border-border bg-background px-3 text-[13px]" />
                      {scannedRows.map((row, index) => (
                        <div key={index} className="grid grid-cols-[minmax(0,1fr)_82px_72px] gap-2">
                          <input value={row.name} onChange={(event) => updateScannedRow(index, "name", event.target.value)} aria-label={`Scanned item ${index + 1} name`} className="h-10 min-w-0 rounded-xl border border-border bg-background px-2.5 text-[12px]" />
                          <input type="number" min="0" step="0.01" value={row.quantity} onChange={(event) => updateScannedRow(index, "quantity", event.target.value)} aria-label={`Scanned item ${index + 1} quantity`} className="h-10 min-w-0 rounded-xl border border-border bg-background px-2 text-[12px]" />
                          <input value={row.unit} onChange={(event) => updateScannedRow(index, "unit", event.target.value)} aria-label={`Scanned item ${index + 1} unit`} className="h-10 min-w-0 rounded-xl border border-border bg-background px-2 text-[12px]" />
                        </div>
                      ))}
                      <button type="submit" disabled={scannedListSaving} className="flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3 text-[13px] font-bold text-primary-foreground disabled:opacity-60">
                        {scannedListSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                        {scannedListSaving ? "Saving reviewed list…" : "Confirm and add scanned list"}
                      </button>
                    </form>
                  ) : null}
        </section>
      ) : null}


{activeStep === 1 && inputMode === "type" ? (
<section id="trip-type-input" className="mt-4 overflow-hidden rounded-[24px] border border-[#3B0A0A] bg-white">
        <div className="px-4 py-4">
          <span className="block text-[14px] font-extrabold">1. Prepare your shopping list</span>
          <span className="mt-1 block text-[11.5px] text-muted-foreground">Scan a photo or add items manually · {items.length} items</span>
        </div>
        <div className="space-y-3 px-3 pb-4">
      {!completed ? (
        <form onSubmit={saveList} className="mt-3 space-y-3 p-1">
          <div>
            <p className="text-[15px] font-extrabold">Enter a shopping list manually</p>
            <p className="mt-1 text-[12px] text-muted-foreground">You can add another list at any time. Each list remains saved separately.</p>
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
                            <button type="button" onClick={() => setExpandedMetadataRows((current) => ({ ...current, [index]: !current[index] }))} className="mt-2 w-full text-left text-[11px] font-semibold text-muted-foreground">+ Add brand / pack size</button>
              {expandedMetadataRows[index] ? (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input value={row.brand} onChange={(event) => updateRow(index, "brand", event.target.value)} placeholder="Brand (optional)" maxLength={100} className="h-9 min-w-0 rounded-lg border border-border bg-white px-2.5 text-[12px]" />
                <input value={row.pack_size} onChange={(event) => updateRow(index, "pack_size", event.target.value)} placeholder="Pack size (optional)" maxLength={60} className="h-9 min-w-0 rounded-lg border border-border bg-white px-2.5 text-[12px]" />
              </div>
              ) : null}
            </div>
          ))}
          <button type="button" onClick={startVoiceEntry} disabled={voiceListening} className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-full border border-border py-2.5 text-[12.5px] font-bold disabled:opacity-60">
            <Mic className="h-4 w-4" /> {voiceListening ? "Listening…" : "Add items by voice"}
          </button>
          <button type="button" onClick={addRow} className="flex w-full items-center justify-center gap-1.5 rounded-full border border-dashed border-border py-2.5 text-[12.5px] font-bold">
            <Plus className="h-4 w-4" /> Add another item
          </button>
          <button type="submit" disabled={saving} className="flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3 text-[13.5px] font-bold text-primary-foreground disabled:opacity-60">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {saving ? "Saving list…" : "Save shopping list"}
          </button>
        </form>
      ) : null}

      
        </div>
      </section>
) : null}

      {estimateDetailsOpen ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" role="presentation">
          <section role="dialog" aria-modal="true" aria-labelledby="estimate-details-title" className="w-full max-w-md rounded-[22px] border border-[#3B0A0A] bg-white p-4 shadow-xl">
            <h2 id="estimate-details-title" className="text-[15px] font-extrabold">Complete item details</h2>
            <p className="mt-1 text-[12px] text-muted-foreground">Every item needs a quantity greater than zero and a unit before you can save an estimate.</p>
            <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
              {estimateDetailItems.map((item) => (
                <div key={item.id} className="rounded-xl bg-secondary/50 px-3 py-2 text-[12px]">
                  <span className="font-bold">{item.product_name}</span>
                  <span className="mt-1 block text-muted-foreground">Quantity: {item.planned_quantity ?? "Missing"} {item.unit || "(unit missing)"}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setEstimateDetailsOpen(false)} className="flex-1 rounded-full border border-border py-2.5 text-[12px] font-bold">Close</button>
              <button type="button" onClick={() => { setEstimateDetailsOpen(false); setActiveStep(1); }} className="flex-1 rounded-full bg-primary py-2.5 text-[12px] font-bold text-primary-foreground">Edit list</button>
            </div>
          </section>
        </div>
      ) : null}


      {activeStep === 2 ? (<section id="trip-list" className="mt-6">
        <div className="mb-3 flex items-center justify-between px-1">
          <div><h2 className="text-[15px] font-extrabold">Your shopping list</h2><p className="text-[11.5px] text-muted-foreground">{items.length} items in this trip</p></div>
          <button type="button" onClick={loadSession} aria-label="Refresh session" className="rounded-full border border-border p-2"><RefreshCw className="h-4 w-4" /></button>
        </div>
        {items.length ? (
          <>
          <div className="mb-3 rounded-[20px] border border-border bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[12.5px] font-extrabold">Shopping progress</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{fullyPurchasedItemCount} of {items.length} items bought · {items.length - fullyPurchasedItemCount} still to buy</p>
              </div>
              <span className="text-[16px] font-extrabold tabular-nums text-primary">{shoppingProgress}%</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-secondary" role="progressbar"
              aria-label="Shopping progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={shoppingProgress}>
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${shoppingProgress}%` }} />
            </div>
          </div>
          <div className="mb-3 rounded-[22px] border border-border bg-white p-3">
            <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input value={smartListSearch} onChange={(event) => setSmartListSearch(event.target.value)} placeholder="Find an item in this trip" aria-label="Search shopping list" className="h-10 min-w-0 flex-1 bg-transparent text-[12.5px] outline-none" />
            </div>
            <div className="mt-2 flex gap-1.5">
              {[
                ["all", "All items"],
                ["remaining", "To buy"],
                ["purchased", "Bought"],
              ].map(([value, label]) => (
                <button key={value} type="button" onClick={() => setSmartListFilter(value)}
                  className={`flex-1 rounded-full px-3 py-2 text-[11px] font-bold ${smartListFilter === value ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"}`}>
                  {label}
                </button>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <label htmlFor="smart-list-sort" className="text-[10.5px] font-semibold text-muted-foreground">Sort:</label>
              <select id="smart-list-sort" value={smartListSort} onChange={(event) => setSmartListSort(event.target.value)} className="h-8 flex-1 rounded-lg border border-border bg-background px-2 text-[10.5px]">
                <option value="category">Category</option><option value="manual">Manual order</option><option value="name">Name A–Z</option><option value="remaining">Most remaining</option><option value="planned">Largest planned qty</option>
              </select>
            </div>
            <p className="mt-2 text-[10.5px] text-muted-foreground">Categories are suggested automatically. You can change any item’s category; your choices stay on this device for this trip.</p>
          </div>
          {editingItemId && !completed ? (
            <form onSubmit={saveItemEdit} className="mb-3 rounded-xl border border-border bg-white p-3 space-y-2">
              <p className="text-xs font-bold">Edit shopping item</p>
              <input value={itemEditDraft.product_name} onChange={(event) => setItemEditDraft((d) => ({ ...d, product_name: event.target.value }))} aria-label="Edit item name" className="h-9 w-full rounded-lg border border-border px-2 text-sm" />
              <div className="grid grid-cols-2 gap-2">
                <input type="number" min="0" step="any" value={itemEditDraft.planned_quantity} onChange={(event) => setItemEditDraft((d) => ({ ...d, planned_quantity: event.target.value }))} aria-label="Edit planned quantity" className="h-9 rounded-lg border border-border px-2 text-sm" />
                <input value={itemEditDraft.unit} onChange={(event) => setItemEditDraft((d) => ({ ...d, unit: event.target.value }))} aria-label="Edit unit" className="h-9 rounded-lg border border-border px-2 text-sm" />
              </div>
              <input value={itemEditDraft.brand} onChange={(event) => setItemEditDraft((d) => ({ ...d, brand: event.target.value }))} aria-label="Edit brand" placeholder="Brand (optional)" className="h-9 w-full rounded-lg border border-border px-2 text-sm" />
              <input value={itemEditDraft.pack_size} onChange={(event) => setItemEditDraft((d) => ({ ...d, pack_size: event.target.value }))} aria-label="Edit pack size" placeholder="Pack size (optional)" className="h-9 w-full rounded-lg border border-border px-2 text-sm" />
              <textarea value={itemEditDraft.notes} onChange={(event) => setItemEditDraft((d) => ({ ...d, notes: event.target.value }))} aria-label="Edit notes" placeholder="Notes (optional)" className="w-full rounded-lg border border-border p-2 text-sm" />
              <div className="flex gap-2"><button type="submit" disabled={itemEditSaving} className="rounded-full bg-primary px-4 py-2 text-xs font-bold text-primary-foreground disabled:opacity-50">{itemEditSaving ? "Saving…" : "Save"}</button><button type="button" onClick={() => setEditingItemId("")} className="rounded-full border border-border px-4 py-2 text-xs font-bold">Cancel</button></div>
            </form>
          ) : null}
          {undoItem ? <div role="status" className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-border bg-secondary/50 p-3 text-sm"><span>Removed {undoItem.product_name}</span><button type="button" onClick={undoPlannedItem} disabled={undoSaving} className="rounded-full bg-primary px-3 py-1.5 font-bold text-primary-foreground disabled:opacity-50">{undoSaving ? "Restoring…" : "Undo"}</button></div> : null}
          <div className="space-y-3">
            {smartListGroups.length ? smartListGroups.map(([category, categoryItems]) => (
              <section key={category} className="overflow-hidden rounded-[22px] border border-border bg-white">
                <div className="flex items-center justify-between bg-secondary/40 px-4 py-3">
                  <h3 className="text-[12.5px] font-extrabold">{category}</h3>
                  <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-bold">{categoryItems.length}</span>
                </div>
                {categoryItems.map((item, index) => (
                  <div key={item.id} className="flex items-start justify-between gap-3 px-4 py-3" style={{ borderTop: index ? "1px solid hsl(var(--border) / 0.8)" : "none" }}>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-baseline gap-1.5">
                        <p className="truncate text-[12.5px] font-bold">{item.product_name}</p>
                        <span className="shrink-0 text-[11px] text-muted-foreground">• {Number(item.planned_quantity)} {item.unit}</span>
                      </div>
                      <p className="mt-0.5 truncate text-[10.5px] text-muted-foreground">
                        {Number(item.remaining_quantity ?? item.planned_quantity)} {item.unit} left to buy
                        {item.brand ? ` · ${item.brand}` : ""}{item.pack_size ? ` · ${item.pack_size}` : ""}
                        {Number(item.purchase_count || 0) > 1 ? ` · ${item.purchase_count} purchases` : ""}
                        {Number(item.unit_mismatch_count || 0) > 0 ? ` · ${item.unit_mismatch_count} unit mismatch(es)` : ""}
                      </p>
                      {!completed && item.item_status !== "cancelled" && items.some((candidate) => candidate.id !== item.id && candidate.item_status !== "cancelled" && String(candidate.unit || "pcs").trim().toLowerCase() === String(item.unit || "pcs").trim().toLowerCase()) ? (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <select value={mergeTargets[item.id] || ""} onChange={(event) => setMergeTargets((current) => ({ ...current, [item.id]: event.target.value }))}
                            aria-label={`Merge ${item.product_name} into another item`} className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-background px-2 text-[10.5px]">
                            <option value="">Keep separate / choose merge target</option>
                            {items.filter((candidate) => candidate.id !== item.id && candidate.item_status !== "cancelled" && String(candidate.unit || "pcs").trim().toLowerCase() === String(item.unit || "pcs").trim().toLowerCase()).map((candidate) => (
                              <option key={candidate.id} value={candidate.id}>{candidate.product_name} · {candidate.unit}</option>
                            ))}
                          </select>
                          <button type="button" onClick={() => mergePlannedItem(item.id)} disabled={!mergeTargets[item.id]}
                            className="rounded-full border border-primary px-3 py-1.5 text-[10.5px] font-bold text-primary disabled:opacity-40">Merge</button>
                        </div>
                      ) : null}
                      {!completed ? (
                        <select value={categoryOverrides[item.id] || "__auto"} onChange={(event) => setCategoryOverrides((current) => {
                            const next = { ...current };
                            if (event.target.value === "__auto") delete next[item.id];
                            else next[item.id] = event.target.value;
                            return next;
                          })}
                          aria-label={`Category for ${item.product_name}`} className="mt-2 h-8 max-w-full rounded-lg border border-border bg-background px-2 text-[10.5px]">
                          <option value="__auto">Auto: {inferShoppingCategory(item.product_name)}</option>
                          {SHOPPING_CATEGORIES.map((option) => <option key={option} value={option}>{option}</option>)}
                        </select>
                      ) : <span className="mt-2 inline-block rounded-full bg-secondary px-2.5 py-1 text-[10px] font-semibold">{category}</span>}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <span className="rounded-full bg-secondary px-2.5 py-1 text-[10px] font-bold capitalize">
                        {Number(item.remaining_quantity ?? item.planned_quantity) <= 0 ? "Purchased" : Number(item.purchased_quantity || 0) > 0 ? "Partially bought" : String(item.item_status || "planned").replaceAll("_", " ")}
                      </span>
                      {!completed ? (
                        <>
                        <button type="button" disabled={smartListSort !== "manual" || index === 0} onClick={() => moveListItem(categoryItems, item, -1)} aria-label={`Move ${item.product_name} up`} className="rounded-full border border-border p-2 text-muted-foreground disabled:opacity-30"><span className="text-[11px] font-bold">↑</span></button>
                        <button type="button" disabled={smartListSort !== "manual" || index === categoryItems.length - 1} onClick={() => moveListItem(categoryItems, item, 1)} aria-label={`Move ${item.product_name} down`} className="rounded-full border border-border p-2 text-muted-foreground disabled:opacity-30"><span className="text-[11px] font-bold">↓</span></button>
                        <button type="button" onClick={() => beginItemEdit(item)} aria-label={`Edit ${item.product_name}`} className="rounded-full border border-border p-2 text-muted-foreground hover:bg-secondary"><span className="text-[11px] font-bold">Edit</span></button>
                        <button type="button" onClick={() => deletePlannedItem(item)} aria-label={`Remove ${item.product_name}`}
                          className="rounded-full p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </button>
                        </>
                      ) : null}
                    </div>
                  </div>
                ))}
              </section>
            )) : (
              <div className="rounded-[22px] border border-dashed border-border bg-white px-5 py-7 text-center">
                <Search className="mx-auto h-6 w-6 text-muted-foreground" />
                <p className="mt-2 text-[13px] font-bold">No items match this view</p>
                <p className="mt-1 text-[12px] text-muted-foreground">Clear the search or switch back to All items.</p>
              </div>
            )}
          </div>
          </>
        ) : (
          <div className="rounded-[22px] border border-dashed border-border px-5 py-7 text-center">
            <ShoppingBasket className="mx-auto h-6 w-6 text-muted-foreground" />
            <p className="mt-2 text-[13px] font-bold">Your list is empty</p>
            <p className="mt-1 text-[12px] text-muted-foreground">Start with a few essentials, or add your own items above.</p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {["Milk", "Eggs", "Rice", "Vegetables", "Bread"].map((suggestion) => (
                <button key={suggestion} type="button" onClick={() => { setRows((current) => [...current.filter((row) => row.name.trim()), { ...blankRow(), name: suggestion }]); toast.info(`${suggestion} added to your entry form above.`); }} className="rounded-full border border-border bg-white px-3 py-1.5 text-[11px] font-semibold">{suggestion} +</button>
              ))}
            </div>
            <p className="mt-1 text-[12px] text-muted-foreground">Add your first list above.</p>
          </div>
        )}
      </section>) : null}

{activeStep === 3 ? (
<section id="trip-step-2" className="mt-4 overflow-hidden rounded-[24px] border border-[#3B0A0A] bg-white">
        <div className="cursor-pointer px-4 py-4">
          <span className="block text-[14px] font-extrabold">2. Estimate your cost</span>
          <span className="mt-1 block text-[11.5px] text-muted-foreground">Get an idea of the total before you shop{latestEstimate ? " · Estimate saved" : ""}</span>
        </div>
        <div className="space-y-3 px-3 pb-4">
      {!completed ? (
        <form onSubmit={saveEstimate} className="mt-5 space-y-3 rounded-[24px] border border-border bg-white p-4">
          <div>
            <p className="text-[15px] font-extrabold">Estimate your shopping cost</p>
            <p className="mt-1 text-[12px] text-muted-foreground">Ask the assistant for approximate market prices, or enter your own. These are planning estimates, not live shop quotes.</p>
          </div>
          {items.length ? items.map((item) => (
            <div key={item.id} className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-bold">{item.product_name}</p>
                <p className="text-[11px] text-muted-foreground">{Number(item.planned_quantity)} {item.unit} · total for this line</p>
                {item.brand || item.pack_size ? (
                  <p className="mt-0.5 truncate text-[10.5px] text-muted-foreground">
                    {[item.brand, item.pack_size].filter(Boolean).join(" · ")}
                  </p>
                ) : null}
              </div>
              <div className="w-28 shrink-0">
                <input type="number" inputMode="decimal" min="0" step="0.01"
                  value={estimatePrices[item.id] ?? ""}
                  onChange={(event) => { setEstimatePrices((current) => ({ ...current, [item.id]: event.target.value })); setEstimateSources((current) => ({ ...current, [item.id]: "manual" })); setRememberedEstimateKeys((current) => { if (!(item.id in current)) return current; const next = { ...current }; delete next[item.id]; return next; }); }}
                  placeholder="₹ total" aria-label={`Estimated total line price for ${item.product_name}`}
                  className="h-10 w-full rounded-xl border border-border bg-background px-2.5 text-[12px]" />
                {estimateSources[item.id] === "remembered" ? <p className="mt-1 text-[10px] font-medium text-muted-foreground">Saved price · exact pack match</p>
                  : estimateSources[item.id] === "ai_estimate" ? <p className="mt-1 text-[10px] font-medium text-muted-foreground">AI estimate · review price</p>
                  : estimateSources[item.id] === "manual" ? <p className="mt-1 text-[10px] font-medium text-muted-foreground">Manual price</p> : null}
              </div>
            </div>
          )) : <p className="rounded-xl bg-secondary/40 px-3 py-3 text-[12px] text-muted-foreground">Add planned items first, then enter their estimated prices.</p>}
          <div className="rounded-[18px] bg-[#EA580C]/10 p-3.5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11.5px] font-bold text-[#EA580C]">Estimated shopping total</p>
              <p className="tnum text-[19px] font-extrabold text-[#EA580C]">{inr(Math.round(draftEstimateRupees * 100))}</p>
            </div>
            <p className="mt-1 text-[10.5px] text-muted-foreground">
              {pricedEstimateItems.length} of {items.length} items priced
              {pricedEstimateItems.length === items.length && items.length > 0
                ? " · Ready to save"
                : " · Partial total — add prices for the remaining items"}
            </p>
          </div>
          {estimateReviewOpen ? (
            <div role="alert" className="mb-3 rounded-[18px] border border-amber-300 bg-amber-50 p-3 text-amber-950">
              <p className="text-[12.5px] font-extrabold">Smart estimate review</p>
              <p className="mt-1 text-[11px] leading-relaxed">Please check these suggestions. Nothing is automatically changed.</p>
              <ul className="mt-2 space-y-1.5">
                {estimateReviewWarnings.map((warning, index) => (
                  <li key={index} className="rounded-lg bg-white/70 px-2.5 py-2 text-[11px]">
                    <span className="font-bold">{warning.itemName}:</span> {warning.message}
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={() => { setEstimateReviewOpen(false); setEstimateReviewWarnings([]); }} className="flex-1 rounded-full border border-amber-700/30 py-2 text-[11px] font-bold">Back to edit</button>
                <button type="submit" disabled={estimateSaving} className="flex-1 rounded-full bg-amber-900 py-2 text-[11px] font-bold text-white disabled:opacity-60">{estimateSaving ? "Saving…" : "Save anyway"}</button>
              </div>
            </div>
          ) : null}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button type="button" onClick={generateAiEstimate} disabled={aiEstimateSaving || estimateSaving || !items.length} className="flex w-full items-center justify-center gap-2 rounded-full border border-primary/30 bg-accent py-3 text-[13px] font-bold text-primary disabled:opacity-60">
              {aiEstimateSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {aiEstimateSaving ? "Estimating…" : "Estimate with AI"}
            </button>
            {!estimateReviewOpen ? <button type="submit" disabled={estimateSaving || aiEstimateSaving || !items.length} className="flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3 text-[13px] font-bold text-primary-foreground disabled:opacity-60">
              {estimateSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {estimateSaving ? "Saving estimate…" : "Save my estimate"}
            </button> : null}
          </div>
        </form>
      ) : null}

      {completed ? (
      <section id="trip-estimate" className="mt-6">
              <h2 className="mb-3 px-1 text-[15px] font-extrabold">Estimate vs actual</h2>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-[18px] border border-border bg-white p-3">
                  <p className="text-[11px] text-muted-foreground">Estimated cost</p>
                  <p className="mt-1 text-[17px] font-extrabold tabular-nums">{latestEstimate ? inr(latestEstimate.estimated_total_paise) : "—"}</p>
                  {latestEstimate ? <p className="mt-1 text-[10px] text-muted-foreground">Version {latestEstimate.version_number}</p> : null}
                </div>
                <div className="rounded-[18px] border border-border bg-white p-3">
                  <p className="text-[11px] text-muted-foreground">Paid so far</p>
                  <p className="mt-1 text-[17px] font-extrabold tabular-nums">{inr(session.actual_total_paise)}</p>
                  {latestEstimate ? <p className="mt-1 text-[10px] text-muted-foreground">{estimateDifference > 0 ? "Over estimate" : estimateDifference < 0 ? "Under estimate" : "Equal to estimate"}: {inr(Math.abs(estimateDifference))}</p> : null}
                </div>
              </div>
              <p className="mt-2 px-1 text-[10.5px] text-muted-foreground">Paid so far uses included bill totals only. Bill item amounts are not added again.</p>
            </section>
    ) : null}

      <section className="mt-4">
        <h2 className="mb-3 px-1 text-[15px] font-extrabold">Lists you added</h2>
        {groupedSourceLists.length || fallbackItems.length ? <div className="space-y-2">
          {groupedSourceLists.map((list) => (
            <div key={list.id} className="rounded-[18px] border border-border bg-white px-4 py-3">
              <p className="text-[13px] font-bold">{list.source_metadata_json ? (() => { try { return JSON.parse(list.source_metadata_json).title || "Shopping list"; } catch { return "Shopping list"; } })() : "Shopping list"}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{list.groupedItems.length} item(s)</p>
              <div className="mt-2 flex flex-wrap gap-1.5">{list.groupedItems.map((item) => <span key={item.id} className="rounded-full bg-secondary px-2.5 py-1 text-[10.5px]">{item.product_name}</span>)}</div>
            </div>
          ))}
          {fallbackItems.length ? <div className="rounded-[18px] border border-dashed border-border bg-white px-4 py-3">
            <p className="text-[13px] font-bold">All items</p>
            <p className="mt-1 text-[11px] text-muted-foreground">Items whose source-line association is unavailable are kept here.</p>
            <div className="mt-2 flex flex-wrap gap-1.5">{fallbackItems.map((item) => <span key={item.id} className="rounded-full bg-secondary px-2.5 py-1 text-[10.5px]">{item.product_name}</span>)}</div>
          </div> : null}
        </div> : <p className="rounded-[18px] bg-secondary/40 px-4 py-4 text-[12px] text-muted-foreground">Your saved lists will appear here.</p>}
      </section>
        </div>
      </section>
) : null}

      {activeStep === 4 ? (
<section id="trip-step-3" className="mt-4 overflow-hidden rounded-[24px] border border-[#3B0A0A] bg-white">
        <div className="cursor-pointer px-4 py-4">
          <span className="block text-[14px] font-extrabold">3. While you're shopping</span>
          <span className="mt-1 block text-[11.5px] text-muted-foreground">
            {fullyPurchasedItemCount} of {items.length} items bought · {(session.bills || []).length} shop bills
          </span>
        </div>
        <div className="space-y-3 px-3 pb-4">
      {!completed ? (
        <form onSubmit={saveBill} className="mt-6 space-y-3 rounded-[24px] border border-border bg-white p-4">
          <div>
            <p className="text-[15px] font-extrabold">Add a shop purchase</p>
            <p className="mt-1 text-[12px] text-muted-foreground">Record each shop purchase. Typed or voice-only bills are marked Unverified until you attach a receipt; scanned bills stay in review until checked.</p>
          </div>
          <button type="button" onClick={startVoiceBillEntry} className="min-h-10 w-full rounded-full border border-primary/30 bg-primary/5 py-2 text-[12px] font-bold text-primary">Voice bill entry (Unverified)</button>
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
            {billSaving ? "Adding bill…" : "Save unverified bill"}
          </button>
        </form>
      ) : null}

      {!completed ? (
        <section className="mt-6 space-y-3 rounded-[24px] border border-border bg-white p-4">
          <div>
            <p className="text-[15px] font-extrabold">Scan a shop bill</p>
            <p className="mt-1 text-[12px] text-muted-foreground">Use the existing reader, review its item details, and enter the exact grand total printed on the bill. The bill total—not the sum of item lines—is counted as spending.</p>
          </div>
          <BillUploader purpose="priced_list" compact onExtracted={handleUploadedBill} />
          {uploadedBillDraft ? (
            <form onSubmit={saveUploadedBill} className="space-y-3 rounded-[18px] border border-primary/25 bg-background p-3">
              <p className="text-[13px] font-extrabold">Check the bill details</p>
              <input value={uploadedBillShop} onChange={(event) => setUploadedBillShop(event.target.value)} placeholder="Shop name" maxLength={160}
                className="h-10 w-full rounded-xl border border-border bg-white px-3 text-[12px]" />
              <input type="date" value={uploadedBillDate} onChange={(event) => setUploadedBillDate(event.target.value)}
                className="h-10 w-full rounded-xl border border-border bg-white px-3 text-[12px]" />
              <div className="space-y-2">
                {uploadedBillRows.length === 0 ? (
                  <p className="rounded-xl bg-secondary/50 px-3 py-3 text-[11.5px] leading-relaxed text-muted-foreground">
                    We couldn't read the item rows. You can still save the receipt by checking the shop and total paid below. Item details can be added later.
                  </p>
                ) : null}
                {uploadedBillRows.map((row, index) => (
                  <div key={index} className="space-y-2 rounded-xl bg-white p-2.5">
                    <input value={row.product_name} onChange={(event) => updateUploadedBillRow(index, "product_name", event.target.value)}
                      aria-label={`Bill item ${index + 1} name`} className="h-9 w-full rounded-lg border border-border px-2.5 text-[12px]" />
                    <div className="grid grid-cols-3 gap-2">
                      <input type="number" min="0" step="0.01" value={row.quantity} onChange={(event) => updateUploadedBillRow(index, "quantity", event.target.value)}
                        aria-label="Bill item quantity" className="h-9 min-w-0 rounded-lg border border-border px-2 text-[11px]" />
                      <input value={row.unit} onChange={(event) => updateUploadedBillRow(index, "unit", event.target.value)}
                        aria-label="Bill item unit" className="h-9 min-w-0 rounded-lg border border-border px-2 text-[11px]" />
                      <input type="number" min="0" step="0.01" value={row.amount} onChange={(event) => updateUploadedBillRow(index, "amount", event.target.value)}
                        aria-label="Bill item amount in rupees" placeholder="₹ amount" className="h-9 min-w-0 rounded-lg border border-border px-2 text-[11px]" />
                    </div>
                    <select value={row.shopping_item_id} onChange={(event) => updateUploadedBillRow(index, "shopping_item_id", event.target.value)}
                      className="h-9 w-full rounded-lg border border-border bg-white px-2 text-[11px]">
                      <option value="">Extra / not matched</option>
                      {items.map((item) => <option key={item.id} value={item.id}>Match: {item.product_name} ({item.unit})</option>)}
                    </select>
                  </div>
                ))}
              </div>
              {uploadedBillLinesTotal !== null && uploadedBillTotal.trim() !== "" ? (
                <div className="rounded-xl border border-border bg-white p-3">
                  <div className="flex items-center justify-between gap-3 text-[11.5px]">
                    <span className="text-muted-foreground">Sum of item lines</span>
                    <span className="font-semibold tabular-nums">{inr(Math.round(uploadedBillLinesTotal * 100))}</span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-3 text-[11.5px]">
                    <span className="text-muted-foreground">
                      {uploadedBillTotalSource === "receipt"
                        ? "AI-read printed total"
                        : uploadedBillTotalSource === "items"
                          ? "Provisional line total"
                          : "Total paid you entered"}
                    </span>
                    <span className="font-semibold tabular-nums">{inr(Math.round(Number(uploadedBillTotal || 0) * 100))}</span>
                  </div>
                  {uploadedBillTotalSource === "items" ? (
                    <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-2 text-[10.5px] leading-relaxed text-amber-900">
                      This amount is only the sum of detected item lines. It may not include GST, discounts, fees or rounding. Check the printed amount payable before saving.
                    </p>
                  ) : Math.abs(uploadedBillLinesTotal - Number(uploadedBillTotal || 0)) >= 0.01 ? (
                    <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-2 text-[10.5px] leading-relaxed text-amber-900">
                      Difference: {inr(Math.round(Math.abs(uploadedBillLinesTotal - Number(uploadedBillTotal || 0)) * 100))}. Check the receipt for GST, discounts, fees or rounding. Keep the printed final total as the amount paid.
                    </p>
                  ) : uploadedBillTotalSource === "receipt" ? (
                    <p className="mt-2 text-[10.5px] font-semibold text-emerald-700">The item-line sum matches the AI-read total. Still verify both against the receipt.</p>
                  ) : (
                    <p className="mt-2 text-[10.5px] font-semibold text-emerald-700">The item amounts match the total you entered.</p>
                  )}
                </div>
              ) : null}
              {uploadedBillDraft?.totals && Object.entries({
                "Items subtotal": uploadedBillDraft.totals.subtotal,
                "Discount": uploadedBillDraft.totals.discount,
                "GST / tax": uploadedBillDraft.totals.tax,
                "Round-off": uploadedBillDraft.totals.roundOff,
              }).some(([, value]) => value != null && Number.isFinite(Number(value))) ? (
                <div className="rounded-xl border border-border bg-white p-3">
                  <p className="mb-2 text-[11.5px] font-bold">Amounts read from the receipt</p>
                  <div className="space-y-1.5">
                    {[
                      ["Items subtotal", uploadedBillDraft.totals.subtotal],
                      ["Discount", uploadedBillDraft.totals.discount],
                      ["GST / tax", uploadedBillDraft.totals.tax],
                      ["Round-off", uploadedBillDraft.totals.roundOff],
                    ].filter(([, value]) => value != null && Number.isFinite(Number(value))).map(([label, value]) => (
                      <div key={label} className="flex items-center justify-between gap-3 text-[11.5px]">
                        <span className="text-muted-foreground">{label}</span>
                        <span className="font-semibold tabular-nums">{inr(Math.round(Number(value) * 100))}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="rounded-xl border border-primary/20 bg-white p-3">
                <label className="block text-[12px] font-bold" htmlFor="uploaded-bill-total">Total paid (₹)</label>
                <input id="uploaded-bill-total" type="number" inputMode="decimal" min="0" step="0.01" required value={uploadedBillTotal}
                  onChange={(event) => { setUploadedBillTotal(event.target.value); setUploadedBillTotalSource("manual"); }}
                  placeholder="Enter the exact total from the receipt"
                  className="mt-2 h-11 w-full rounded-xl border border-border bg-background px-3 text-[14px] font-semibold" />
                <p className="mt-2 text-[10.5px] leading-relaxed text-muted-foreground">
                  {uploadedBillTotalSource === "receipt"
                    ? `AI read ${uploadedBillDraft?.totals?.grandTotalLabel || "a printed final total"}: ${inr(Math.round(Number(uploadedBillTotal || 0) * 100))}. Please check it against the receipt before saving.`
                    : uploadedBillTotalSource === "items"
                      ? "Provisional total calculated from all detected item amounts. This is not a confirmed receipt total; check taxes, discounts and the printed amount due."
                      : "No reliable printed total was found. Enter the exact amount paid from the receipt."}
                </p>
                {uploadedBillDraft?.totals?.grandTotal != null && uploadedBillTotalSource === "receipt" ? (
                  <p className="mt-1 text-[10.5px] text-muted-foreground">The AI-detected amount is only a suggestion. You must verify it.</p>
                ) : null}
              </div>
              <button type="submit" disabled={uploadedBillSaving} className="flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3 text-[12px] font-bold text-primary-foreground disabled:opacity-60">
                {uploadedBillSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {uploadedBillSaving ? "Saving bill…" : "Confirm reviewed bill"}
              </button>
            </form>
          ) : null}
        </section>
      ) : null}

      <section id="trip-bills" className="mt-6">
        <h2 className="mb-3 px-1 text-[15px] font-extrabold">Bills from your shops</h2>
        {(session.bills || []).length ? (
          <div className="space-y-2">{session.bills.map((bill) => (
            <div key={bill.id} className="rounded-[18px] border border-border bg-white px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div><p className="text-[13px] font-bold">{bill.shop_name || "Shop not named"}</p><p className="mt-1 text-[11px] text-muted-foreground">{bill.receipt_number || "Receipt number not recorded"}</p><span className={`mt-1 inline-flex rounded-full px-2 py-1 text-[10px] font-bold ${bill.bill_status === "verified" ? "bg-emerald-100 text-emerald-800" : "bg-orange-100 text-orange-800"}`}>{bill.bill_status === "verified" ? "Verified · receipt attached" : ["duplicate", "void"].includes(bill.bill_status) ? String(bill.bill_status).toUpperCase() : "Unverified · no confirmed receipt"}</span></div>
                <div className="flex shrink-0 flex-col items-end gap-1"><p className="text-[13px] font-extrabold tabular-nums">{bill.bill_total_paise == null ? "Amount pending" : inr(bill.bill_total_paise)}</p>{!completed ? <button type="button" onClick={() => deleteBill(bill.id)} className="text-[10.5px] font-bold text-destructive underline">Delete bill</button> : null}</div>
              </div>
              {!completed ? (
                <div className="mt-2">
                  <label className="mb-1 block text-[10.5px] font-semibold text-muted-foreground" htmlFor={`bill-status-${bill.id}`}>Bill status</label>
                  <select id={`bill-status-${bill.id}`} value={bill.bill_status} onChange={(event) => updateBillStatus(bill.id, event.target.value)}
                    className="h-9 w-full rounded-lg border border-border bg-background px-2.5 text-[11.5px]">
                    <option value="uploaded">Uploaded / counted</option>
                    <option value="needs_review">Needs review / counted</option>
                    <option value="verified">Verified / counted</option>
                    <option value="duplicate">Duplicate / exclude</option>
                    <option value="void">Void / exclude</option>
                  </select>
                </div>
              ) : null}
              {bill.file_id ? <a href={`/api/files/${bill.file_id}/content`} target="_blank" rel="noreferrer" className="mt-2 inline-block text-[11.5px] font-bold text-primary underline">View saved bill photo / PDF</a> : null}
              <button type="button" onClick={() => loadBillLines(bill.id)} className="mt-3 text-[11.5px] font-bold text-primary underline">Load / refresh bill items</button>
              {billLineDetails[bill.id] ? (
                <div className="mt-2 space-y-1.5">
                  {billLineDetails[bill.id].length ? billLineDetails[bill.id].map((line) => (
                    <div key={line.id} className="rounded-lg bg-secondary/40 px-2.5 py-2 text-[11px]">
                      {billLineEditDrafts[line.id] ? (
                        <div className="space-y-1.5">
                          <input value={billLineEditDrafts[line.id].product_name} onChange={(event) => setBillLineEditDrafts((current) => ({ ...current, [line.id]: { ...current[line.id], product_name: event.target.value } }))} aria-label="Edit bill item name" className="h-10 w-full rounded-lg border border-border bg-background px-2.5" />
                          <div className="grid grid-cols-2 gap-2">
                            <input type="number" min="0" step="0.01" value={billLineEditDrafts[line.id].quantity} onChange={(event) => setBillLineEditDrafts((current) => ({ ...current, [line.id]: { ...current[line.id], quantity: event.target.value } }))} aria-label="Edit quantity" className="h-10 min-w-0 rounded-lg border border-border bg-background px-2.5" />
                            <input type="number" min="0" step="0.01" value={billLineEditDrafts[line.id].amount} onChange={(event) => setBillLineEditDrafts((current) => ({ ...current, [line.id]: { ...current[line.id], amount: event.target.value } }))} aria-label="Edit line amount" placeholder="₹ amount" className="h-10 min-w-0 rounded-lg border border-border bg-background px-2.5" />
                          </div>
                          <div className="flex gap-2">
                            <button type="button" disabled={billLineEditSaving === line.id} onClick={() => saveBillLineEdit(bill.id, line.id)} className="text-primary font-bold underline">Save</button>
                            <button type="button" onClick={() => setBillLineEditDrafts((current) => { const next = { ...current }; delete next[line.id]; return next; })} className="text-muted-foreground underline">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex justify-between gap-2">
                          <span className="min-w-0">{line.product_name} · {Number(line.quantity)} {line.unit}{line.is_extra ? " · Extra" : ""}</span>
                          <div className="flex shrink-0 items-center gap-2">
                            <span className="font-bold">{line.line_amount_paise == null ? "Amount not entered" : inr(line.line_amount_paise)}</span>
                            {!completed ? <button type="button" onClick={() => editBillLine(bill.id, line)} aria-label={`Edit ${line.product_name}`} className="font-bold text-primary underline">Edit</button> : null}
                            {!completed ? <button type="button" onClick={() => deleteBillLine(bill.id, line.id)} aria-label={`Delete ${line.product_name}`} className="rounded-full p-1 text-muted-foreground hover:bg-white"><Trash2 className="h-3 w-3" /></button> : null}
                          </div>
                        </div>
                      )}
                    </div>
                  )) : <p className="text-[11px] text-muted-foreground">No item details recorded yet.</p>}
                </div>
              ) : null}
              {!completed ? (
                <form onSubmit={(event) => saveBillLine(event, bill.id)} className="mt-3 space-y-2 border-t border-border pt-3">
                  <p className="text-[11.5px] font-bold">Add a bill item</p>
                  <input value={(billLineForms[bill.id] || {}).product_name || ""} onChange={(event) => updateBillLine(bill.id, "product_name", event.target.value)}
                    placeholder="Product name" maxLength={160} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-[12px]" />
                  <div className="grid grid-cols-3 gap-2">
                    <input type="number" min="0" step="0.01" value={(billLineForms[bill.id] || {}).quantity || "1"} onChange={(event) => updateBillLine(bill.id, "quantity", event.target.value)}
                      aria-label="Bill item quantity" className="h-10 min-w-0 rounded-lg border border-border bg-background px-2.5 text-[12px]" />
                    <input value={(billLineForms[bill.id] || {}).unit || "pcs"} onChange={(event) => updateBillLine(bill.id, "unit", event.target.value)}
                      aria-label="Bill item unit" placeholder="Unit" className="h-10 min-w-0 rounded-lg border border-border bg-background px-2.5 text-[12px]" />
                    <input type="number" min="0" step="0.01" value={(billLineForms[bill.id] || {}).amount || ""} onChange={(event) => updateBillLine(bill.id, "amount", event.target.value)}
                      aria-label="Bill item amount in rupees" placeholder="₹ amount" className="h-10 min-w-0 rounded-lg border border-border bg-background px-2.5 text-[12px]" />
                  </div>
                  <select value={(billLineForms[bill.id] || {}).shopping_item_id || ""} onChange={(event) => updateBillLine(bill.id, "shopping_item_id", event.target.value)}
                    className="h-10 w-full rounded-lg border border-border bg-background px-3 text-[12px]">
                    <option value="">Extra / not matched to list</option>
                    {items.map((item) => <option key={item.id} value={item.id}>Match to: {item.product_name} ({item.planned_quantity} {item.unit})</option>)}
                  </select>
                  <button type="submit" disabled={billLineSaving === bill.id} className="w-full rounded-full border border-primary py-2 text-[11.5px] font-bold text-primary disabled:opacity-60">
                    {billLineSaving === bill.id ? "Saving item…" : "Add bill item"}
                  </button>
                </form>
              ) : null}
            </div>
          ))}</div>
        ) : <p className="rounded-[18px] bg-secondary/40 px-4 py-4 text-[12px] text-muted-foreground">No bills added yet. Add a shop purchase or scan a receipt to record what you paid.</p>}
      </section>
        </div>
      </section>
) : null}

      {activeStep === 4 ? (
<section id="trip-step-4" className="mt-4 overflow-hidden rounded-[24px] border border-[#3B0A0A] bg-white">
        <div className="cursor-pointer px-4 py-4">
          <span className="block text-[14px] font-extrabold">4. Finish your trip</span>
          <span className="mt-1 block text-[11.5px] text-muted-foreground">Review your totals and save the final shopping summary</span>
        </div>
        <div className="space-y-3 px-3 pb-4">
      {!completed ? (
        <form id="trip-finish" onSubmit={confirmSession} className="mt-6 space-y-3 rounded-[24px] border border-primary/25 bg-white p-4">
          <div>
            <p className="text-[15px] font-extrabold">Finish this trip</p>
            <p className="mt-1 text-[12px] text-muted-foreground">Check each bill, then confirm the total you paid. Any unpurchased planned items will remain visible in the completion record.</p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11.5px]">
            <div className="rounded-xl bg-secondary/50 p-3">
              <p className="text-muted-foreground">Bills counted</p>
              <p className="mt-1 text-[15px] font-extrabold">{(session.bills || []).filter((bill) => Number(bill.included_in_actual) === 1 && !["duplicate", "void"].includes(bill.bill_status)).length}</p>
            </div>
            <div className="rounded-xl bg-secondary/50 p-3">
              <p className="text-muted-foreground">Items still pending</p>
              <p className="mt-1 text-[15px] font-extrabold">{items.filter((item) => Number(item.remaining_quantity ?? item.planned_quantity) > 0).length}</p>
            </div>
          </div>
          {unresolvedBills.length > 0 ? (
            <p className="rounded-xl bg-secondary/60 px-3 py-2.5 text-[11.5px] font-semibold text-foreground">
              Review {unresolvedBills.length} bill(s) above. Mark each one Verified, Duplicate or Void before confirming the final expense.
            </p>
          ) : null}
          {Number(session.bills_amount_pending || 0) > 0 ? (
            <p className="rounded-xl bg-destructive/10 px-3 py-2.5 text-[11.5px] font-semibold text-destructive">
              {session.bills_amount_pending} bill amount(s) are unreadable or missing. Enter or correct those amounts before completing the session.
            </p>
          ) : null}
          <p className="text-[12px] text-muted-foreground">Ready to finish? The included bills total {inr(session.actual_total_paise)}. Unpurchased list items will remain in your summary.</p>
          <button type="button" onClick={() => setAdjustFinalTotal((value) => !value)} className="text-[11.5px] font-bold text-primary underline">{adjustFinalTotal ? "Hide total adjustment" : "Adjust final total (optional)"}</button>
          {adjustFinalTotal ? <div>
            <label className="mb-1 block text-[11.5px] font-bold" htmlFor="confirmation-total">Final total paid (₹)</label>
            <input id="confirmation-total" type="number" inputMode="decimal" min="0" step="0.01" required value={confirmationTotal}
              onChange={(event) => { confirmationRequestKeyRef.current = null; setConfirmationTotal(event.target.value); }}
              className="h-11 w-full rounded-xl border border-border bg-background px-3 text-[14px] font-semibold" />
            <p className="text-[10.5px] text-muted-foreground">Default is the total from included bills. Adjust only if your actual payment differs.</p>
          </div> : null}
          <button type="submit" disabled={confirmationSaving || unresolvedBills.length > 0 || Number(session.bills_amount_pending || 0) > 0}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3 text-[13px] font-bold text-primary-foreground disabled:opacity-50">
            {confirmationSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingBasket className="h-4 w-4" />}
            {confirmationSaving ? "Finishing trip…" : "Finish trip"}
          </button>
        </form>
      ) : (
        <section id="trip-finish" className="mt-6 rounded-[24px] border border-border bg-white p-4">
          <p className="text-[15px] font-extrabold">Trip finished</p>
          <p className="mt-1 text-[12px] text-muted-foreground">Final confirmed expense: {inr(session.confirmed_actual_total_paise)}. Your trip summary is saved and cannot be edited.</p>
          <p className="mt-2 text-[11px] text-muted-foreground">{items.filter((item) => Number(item.remaining_quantity ?? item.planned_quantity) > 0).length} planned item(s) remain unpurchased or partially purchased.</p>
          <button type="button" onClick={() => {
            const rows = [["Shopping Trip", tripName || "Shopping"], ["Date", tripDate || ""], ["Final total (₹)", (Number(session.confirmed_actual_total_paise || 0) / 100).toFixed(2)], ["Planned Items"], ...items.map((item) => [item.product_name, item.planned_quantity, item.unit]), ["Bills"], ...(session.bills || []).map((bill) => [bill.shop_name || "Shop", (Number(bill.bill_total_paise || 0) / 100).toFixed(2), bill.bill_status])];
            const csv = rows.map((row) => row.map((value) => String(value ?? "").split('"').join('""')).map((value) => '"' + value + '"' ).join(",")).join("\\r\\n");
            const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
            const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "shopping-trip-summary.csv"; link.click(); URL.revokeObjectURL(url);
          }} className="mt-3 w-full rounded-full border border-primary py-3 text-[12px] font-bold text-primary">Download Summary (CSV)</button>
        </section>
      )}

      {completed ? <PriceComparisonPanel items={items} estimatePrices={estimatePrices} /> : null}
      <section className="mt-6">
        <h2 className="mb-3 px-1 text-[15px] font-extrabold">Saved estimates</h2>
        {(session.estimates || []).length ? (
          <div className="space-y-2">{session.estimates.map((estimate) => (
            <div key={estimate.id} className="flex items-center justify-between rounded-[18px] border border-border bg-white px-4 py-3">
              <div><p className="text-[13px] font-bold">Estimate v{estimate.version_number}</p><p className="mt-1 text-[11px] text-muted-foreground">{new Date(estimate.created_at).toLocaleString("en-IN")}</p></div>
              <p className="text-[13px] font-extrabold tabular-nums">{inr(estimate.estimated_total_paise)}</p>
            </div>
          ))}</div>
        ) : <p className="rounded-[18px] bg-secondary/40 px-4 py-4 text-[12px] text-muted-foreground">Create an estimate above. Each saved version is retained; newer estimates do not overwrite older ones.</p>}
      </section>
        </div>
      </section>
) : null}
      {pendingConfirmDialog}
      <StyledConfirmModal open={deleteTripDialogOpen} title="Delete this shopping trip?" description="This will delete the trip and all saved trip data (lists, items, estimates, bills and history). Uploaded files are retained and not physically deleted. This cannot be undone." confirmLabel="Delete trip" destructive onCancel={() => setDeleteTripDialogOpen(false)} onConfirm={confirmDeleteTrip} />
      <StyledConfirmModal open={Boolean(pendingTotalDifference)} title="Confirm final expense difference" description={pendingTotalDifference ? `Your confirmed total is ₹${pendingTotalDifference.rupees.toFixed(2)}, but bills calculate to ₹${pendingTotalDifference.calculatedRupees.toFixed(2)} (₹${Math.abs(pendingTotalDifference.difference).toFixed(2)} ${pendingTotalDifference.difference > 0 ? "higher" : "lower"}). Save this difference in the final confirmation?` : ""} confirmLabel="Confirm total" onCancel={() => setPendingTotalDifference(null)} onConfirm={() => finishSession(pendingTotalDifference?.rupees)} />
      {!completed ? (
        <div className="fixed inset-x-0 bottom-[76px] z-30 mx-auto max-w-md border-t border-border bg-white/95 px-4 py-3 shadow-lg backdrop-blur">
          <button type="button" onClick={() => setActiveStep((step) => Math.min(4, step + 1))} disabled={activeStep === 4}
            className="flex w-full items-center justify-center rounded-full bg-[#EA580C] px-4 py-3.5 text-sm font-extrabold text-white shadow-lg disabled:opacity-40">
            {activeStep === 1 ? "Next: Review List →" : activeStep === 2 ? "Next: AI Estimate →" : activeStep === 3 ? "Next: Shop & Finish →" : "Finish"}
          </button>
        </div>
      ) : null}
    </div>
  );
}