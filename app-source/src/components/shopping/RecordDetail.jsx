import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { FileImage, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { base44 } from "@/api/cloudflareClient";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ddmmyyyy, formatQty, inr } from "@/lib/format";
import { PriceComparisonPanel } from "@/components/shopping/PriceComparisonPanel";
import { BillUploader } from "@/components/shopping/BillUploader";

export function RecordDetail({ record, onDeleted }) {
  const [deleting, setDeleting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [verifiedRecord, setVerifiedRecord] = useState(null);
  const [verifyingBill, setVerifyingBill] = useState(false);
  const displayRecord = verifiedRecord || record;
  const items = record.items || [];
  const total = record.source === "session" ? (Number(record.total) || 0) : (items.reduce((s, i) => s + (Number(i.amount) || 0), 0) || Number(record.total) || 0);

  const openBill = async () => {
    try {
      const { signed_url } = await base44.integrations.Core.CreateFileSignedUrl({
        file_uri: record.bill_file_uri,
        expires_in: 600,
      });
      window.open(signed_url, "_blank", "noopener");
    } catch {
      /* ignore */
    }
  };

  const attachVerificationBill = async (_extracted, fileUri) => {
    if (!fileUri || verifyingBill) return;
    setVerifyingBill(true);
    try {
      const updated = await base44.entities.ShoppingRecord.update(record.id, {
        shop_name: record.shop_name || "", date: record.date, items, total, item_count: items.length,
        notes: record.notes || "", source: "bill", bill_file_uri: fileUri,
        receipts: record.receipts || [], reconciliation_status: record.reconciliation_status || "not_required",
      });
      setVerifiedRecord(updated);
      toast.success("Bill uploaded — purchase verified");
    } catch (error) {
      toast.error("Bill uploaded, but verification could not be saved", { description: error?.message || "Please try again." });
    } finally { setVerifyingBill(false); }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await base44.entities.ShoppingRecord.delete(record.id);
      toast.success("Shopping deleted", { description: "The record and its total have been removed from your history." });
      setDeleteDialogOpen(false);
      onDeleted();
    } catch (error) {
      toast.error("Could not delete this shopping", { description: error?.message || "Please try again." });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-4 pb-28">
      <div className="rounded-[28px] bg-primary px-6 py-6 text-primary-foreground">
        <p className="micro text-white/65">{ddmmyyyy(record.date)}</p>
        <h1 className="mt-2 text-[24px] font-extrabold leading-tight">
          {record.shop_name || "Shopping"}
        </h1>
        <p className="tnum mt-3 text-[34px] font-extrabold leading-none">{inr(total)}</p>
        <p className="mt-2 text-[12px] text-white/65">
          {items.length} {items.length === 1 ? "item" : "items"} ·{" "}
          {record.source === "session" ? "Completed shopping session" : record.source === "bill" ? "Read from bill" : "Added manually"}
        </p>
      </div>

      <section className="overflow-hidden rounded-[24px] border border-border bg-white">
        <div className="grid grid-cols-[1fr_auto_auto] gap-3 border-b border-border bg-secondary/50 px-5 py-2.5">
          <span className="micro text-muted-foreground">Item</span>
          <span className="micro w-16 text-right text-muted-foreground">Qty</span>
          <span className="micro w-20 text-right text-muted-foreground">Amount</span>
        </div>
        {items.map((item, i) => (
          <div
            key={i}
            className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-5 py-3"
            style={{ borderTop: i === 0 ? "none" : "1px solid hsl(var(--border) / 0.7)" }}
          >
            <div className="min-w-0">
              <p className="truncate text-[14.5px] font-semibold">{item.name}</p>
              {Number(item.price) > 0 ? (
                <p className="text-[11.5px] text-muted-foreground">{inr(item.price)} each</p>
              ) : null}
            </div>
            <span className="w-16 text-right text-[13px] text-muted-foreground">
              {formatQty(item.qty, item.unit)}
            </span>
            <span className="tnum w-20 text-right text-[14px] font-bold">{inr(item.amount)}</span>
          </div>
        ))}
        <div className="grid grid-cols-[1fr_auto] items-center gap-3 border-t border-border bg-secondary/50 px-5 py-3.5">
          <span className="text-[13px] font-bold">Grand total</span>
          <span className="tnum text-[19px] font-extrabold">{inr(total)}</span>
        </div>
      </section>

      <section className="rounded-[20px] border border-border bg-white px-4 py-3.5">
        <h2 className="text-[13px] font-extrabold">How this total is calculated</h2>
        <div className="mt-2 space-y-1.5 text-[12px] leading-relaxed text-muted-foreground">
          <p>Each item row shows its recorded quantity and line amount. A unit price is shown underneath an item when available.</p>
          {record.source !== "session" && !displayRecord.bill_file_uri && record.source !== "bill" ? (
        <section className="rounded-[22px] border border-amber-200 bg-white p-4">
          <div className="mb-3"><p className="text-[13px] font-extrabold">Unverified purchase</p><p className="mt-1 text-[11.5px] text-muted-foreground">Add the bill anytime to verify this quick log.</p></div>
          <BillUploader compact purpose="priced_list" onExtracted={attachVerificationBill} />
        </section>
      ) : null}

      {record.source === "session" ? (
            <p>The grand total is the final expense you confirmed for this trip. It is the authoritative paid total, even if item details or receipt rows are incomplete.</p>
          ) : (
            <p>The total is based on recorded item amounts, with the saved record total used as a fallback when item amounts are missing.</p>
          )}
        </div>
      </section>

      {Array.isArray(record.receipts) && record.receipts.length > 0 ? (
        <section className="rounded-[22px] border border-border bg-white p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[13px] font-extrabold">Receipts ({record.receipts.length})</h2>
            <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${record.reconciliation_status === "complete" ? "bg-emerald-50 text-emerald-700" : record.reconciliation_status === "pending" ? "bg-amber-50 text-amber-800" : "bg-secondary text-muted-foreground"}`}>
              {record.reconciliation_status === "complete" ? "Reconciled" : record.reconciliation_status === "pending" ? "Pending actual bill" : record.reconciliation_status === "partial" ? "Partially reconciled" : "Receipt records"}
            </span>
          </div>
          <div className="mt-3 space-y-2">
            {record.receipts.map((receipt, index) => (
              <div key={receipt.id || index} className="flex items-center justify-between gap-3 rounded-xl bg-secondary/40 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-[12px] font-bold">{receipt.kind === "actual" ? "Actual bill" : `Receipt ${index + 1}`}</p>
                  <p className="text-[10.5px] text-muted-foreground">
                  {receipt.shop_name ? `${receipt.shop_name} · ` : ""}
                  {receipt.receipt_number ? `#${receipt.receipt_number} · ` : ""}
                  {receipt.status === "pending" ? "Actual bill still needed" : receipt.status === "skipped" ? "Actual bill skipped" : receipt.status === "duplicate" ? "Duplicate receipt excluded" : receipt.status === "void" ? "Voided receipt excluded" : `${receipt.item_count || 0} item(s) recorded`}
                </p>
                {receipt.file_uri && /^cf-file:[a-f0-9-]{36}$/i.test(String(receipt.file_uri)) ? (
                  <a href={`/api/files/${String(receipt.file_uri).slice(8)}/content`} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[10.5px] font-bold text-primary underline">Open receipt</a>
                ) : null}
                </div>
                <span className="tnum shrink-0 text-[12px] font-bold">{receipt.amount > 0 ? inr(receipt.amount) : "Amount not recorded"}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {record.source !== "session" && items.length ? (
        <PriceComparisonPanel
          items={items.map((item, index) => ({ id: item.id || "history-item-" + index, product_name: item.name, planned_quantity: item.qty, unit: item.unit || "pcs", brand: item.brand || "", pack_size: item.pack_size || "" }))}
          estimatePrices={Object.fromEntries(items.map((item, index) => [item.id || "history-item-" + index, Number(item.price || 0) / 100]).filter(([, price]) => price > 0))}
          baselineLabel="Paid price"
        />
      ) : null}
      {record.notes ? (
        <div className="rounded-[20px] border border-border bg-white px-5 py-4">
          <p className="micro text-muted-foreground">Notes</p>
          <p className="mt-1.5 text-[13.5px] leading-relaxed">{record.notes}</p>
        </div>
      ) : null}

      {displayRecord.bill_file_uri ? (
        <button
          type="button"
          onClick={openBill}
          className="flex w-full items-center justify-center gap-2 rounded-full border border-border bg-white py-3 text-[13px] font-bold transition-colors hover:bg-secondary"
        >
          <FileImage className="h-4 w-4" /> View uploaded list / bill
        </button>
      ) : null}

      {record.source === "session" ? (
        <div className="rounded-[20px] border border-border bg-secondary/40 px-4 py-3 text-[12px] text-muted-foreground">
          This shopping session is completed. Its confirmed expense is read-only; receipt attachments remain available above.
        </div>
      ) : (
      <div className="!mt-6 rounded-[24px] border border-border bg-white px-4 py-3">
        <div className="flex items-center gap-2.5">
          <Link
            to="/record/$recordId/edit"
            params={{ recordId: record.id }}
            className="flex flex-1 items-center justify-center gap-2 rounded-full bg-primary py-3 text-[14px] font-bold text-primary-foreground"
          >
            <Pencil className="h-4 w-4" /> Edit
          </Link>
          <AlertDialog open={deleteDialogOpen} onOpenChange={(open) => { if (!deleting) setDeleteDialogOpen(open); }}>
            <AlertDialogTrigger asChild>
              <button
                type="button"
                className="flex items-center justify-center gap-2 rounded-full border border-border bg-white px-5 py-3 text-[14px] font-bold text-destructive"
              >
                <Trash2 className="h-4 w-4" /> Delete
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this shopping?</AlertDialogTitle>
                <AlertDialogDescription>
                  {record.shop_name || "This record"} · {inr(total)} will be removed from your hisab. This
                  cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deleting}>Keep it</AlertDialogCancel>
                <button type="button" onClick={remove} disabled={deleting} className="inline-flex h-10 items-center justify-center rounded-md bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground disabled:opacity-60">
                  {deleting ? "Deleting…" : "Delete record"}
                </button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
      )}
    </div>
  );
}