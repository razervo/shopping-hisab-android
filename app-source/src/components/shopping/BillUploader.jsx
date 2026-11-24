import { useRef, useState } from "react";
import { Camera, FileText, ImageUp, Loader2, ShieldCheck } from "lucide-react";
import { base44 } from "@/api/cloudflareClient";
import { readShoppingBill } from "@/lib/server-fns";
import { BILL_MAX_BYTES, isAcceptedBill, prepareBillFile } from "@/lib/billFile";

export function BillUploader({
  onExtracted,
  purpose = "shopping_list",
  compact = false,
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fileName, setFileName] = useState("");
  const [recoveryFileUri, setRecoveryFileUri] = useState("");
  const uploadLockRef = useRef(false);
  const uploadKeyRef = useRef({ fingerprint: "", key: "" });
  const selectedFileRef = useRef(null);

  const handleFile = async (picked) => {
    if (!picked || uploadLockRef.current) return;
    setError("");
    setRecoveryFileUri("");
    if (!isAcceptedBill(picked)) {
      setError("Please choose a valid JPG, PNG, WEBP, HEIC photo or PDF bill.");
      return;
    }
    if (!picked.size) {
      setError("The selected file is empty. Please take another photo or choose another file.");
      return;
    }

    selectedFileRef.current = picked;
    setFileName(picked.name);
    const fingerprint = [picked.name, picked.size, picked.lastModified].join(":");
    if (uploadKeyRef.current.fingerprint !== fingerprint) {
      uploadKeyRef.current = { fingerprint, key: crypto.randomUUID() };
    }
    const uploadKey = uploadKeyRef.current.key;
    uploadLockRef.current = true;
    setBusy(true);

    let file;
    try {
      file = await prepareBillFile(picked);
    } catch (cause) {
      setError(cause?.message || "This image could not be prepared. Please choose a JPG, PNG or WEBP photo.");
      uploadLockRef.current = false;
      setBusy(false);
      return;
    }

    if (file.size > BILL_MAX_BYTES) {
      setError("That file is too large. Please use a photo or PDF under 10 MB.");
      uploadLockRef.current = false;
      setBusy(false);
      return;
    }

    try {
      const directImage = ["image/jpeg", "image/png", "image/webp"].includes(
        String(file.type || "").toLowerCase(),
      );
      if (directImage) {
        // Send the photo straight to the vision model while saving the original to Drive.
        const form = new FormData();
        form.append("file", file, file.name || "shopping-list.jpg");
        form.append("purpose", purpose);
        // This endpoint uploads the original image to Drive as well as running OCR.
        // It is a non-idempotent POST, so automatic retries can create duplicate Drive files
        // if the server completed the upload but the client lost the response.
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 90000);
        let response;
        let result = {};
        try {
          response = await fetch("/api/ai/read-bill", { method: "POST", body: form, credentials: "include", signal: controller.signal, headers: { "Idempotency-Key": uploadKey } });
        } finally { clearTimeout(timeout); }
        result = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(result?.error || `Bill reading failed (${response.status}).`);
        }
        if (result?.recoverable && result?.file_uri) {
          setRecoveryFileUri(result.file_uri);
          setError(result.error || "Receipt saved, but reading failed. You can retry.");
          return;
        }
        if (!result?.draft || !result?.file_uri) {
          throw new Error(result?.error || "We could not read this bill. Try a clearer, straight photo.");
        }
        uploadKeyRef.current = { fingerprint: "", key: "" };
        selectedFileRef.current = null;
        onExtracted(result.draft, result.file_uri);
      } else {
        // Keep the existing PDF/other supported-file route unchanged.
        const uploaded = await base44.integrations.Core.UploadPrivateFile({ file, idempotencyKey: uploadKey });
        const fileUri = uploaded?.file_uri || "";
        if (!fileUri) throw new Error("The bill could not be uploaded.");
        const result = await readShoppingBill({ data: { fileUri, purpose } });
        if (!result?.draft) {
          setRecoveryFileUri(fileUri);
          throw new Error(result?.error || "The receipt was saved, but reading failed. Retry reading the saved receipt.");
        }
        uploadKeyRef.current = { fingerprint: "", key: "" };
        selectedFileRef.current = null;
        onExtracted(result.draft, fileUri);
      }
    } catch (cause) {
      setError(cause?.message || "We could not read this bill. Please try again or enter the items manually.");
    } finally {
      uploadLockRef.current = false;
      setBusy(false);
    }
  };

  const retrySelectedFile = () => {
    const selected = selectedFileRef.current;
    if (selected && !uploadLockRef.current) handleFile(selected);
  };

  const retrySavedReceipt = async () => {
    if (!recoveryFileUri || uploadLockRef.current) return;
    uploadLockRef.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await readShoppingBill({ data: { fileUri: recoveryFileUri, purpose } });
      if (!result?.draft || !Array.isArray(result.draft.items) ||
          (!result.draft.items.length && purpose !== "priced_list")) {
        throw new Error(result?.error || "AI still could not read this receipt. You can enter items manually.");
      }
      const savedUri = recoveryFileUri;
      setRecoveryFileUri("");
      onExtracted(result.draft, savedUri);
    } catch (cause) {
      setError(cause?.message || "Retry failed. Your receipt is still saved in Drive.");
    } finally {
      uploadLockRef.current = false;
      setBusy(false);
    }
  };

  const onChange = async (e) => {
    const input = e.currentTarget;
    const picked = input.files?.[0];
    // Clear immediately so the same photo can be selected again after a failed attempt.
    input.value = "";
    if (picked) await handleFile(picked);
  };

  const cameraInput = (
    <label className="relative block cursor-pointer">
      <input
        type="file"
        accept="image/*,.jpg,.jpeg,.png,.webp,.heic,.heif"
        capture="environment"
        disabled={busy}
        onChange={onChange}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        aria-label="Take a photo"
      />
      <span className="pointer-events-none flex items-center justify-center gap-2 rounded-full bg-primary px-4 py-3 text-[13px] font-bold text-primary-foreground">
        <Camera className="h-4 w-4" /> Take photo
      </span>
    </label>
  );

  const galleryInput = (
    <label className="relative block cursor-pointer">
      <input
        type="file"
        accept="image/*,application/pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.pdf"
        disabled={busy}
        onChange={onChange}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        aria-label="Choose photo or PDF"
      />
      <span className="pointer-events-none flex items-center justify-center gap-2 rounded-full border border-border bg-white px-4 py-3 text-[13px] font-bold text-foreground">
        <ImageUp className="h-4 w-4" /> Gallery / PDF
      </span>
    </label>
  );

  if (compact) {
    return (
      <div className="space-y-3 rounded-[22px] border border-border bg-white p-3.5">
        <div className="flex items-start gap-2">
          <FileText className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div>
            <p className="text-[12.5px] font-extrabold">{purpose === "priced_list" ? "Scan your priced list or final bill" : "Scan a shopping list photo"}</p>
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
              {purpose === "priced_list" ? "Photo or PDF of your list with actual prices, or the final shop bill. We match item names and update rates for your review." : "Take a photo or choose a saved image/PDF. We extract item names and quantities, then you review before adding them."}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {cameraInput}
          {galleryInput}
        </div>
        {busy ? (
          <div className="flex items-center gap-2 text-[12px] font-semibold text-primary">
            <Loader2 className="h-4 w-4 animate-spin" /> Reading actual prices from {fileName || "your list"}…
          </div>
        ) : null}
        {error ? (
          <p className="rounded-xl bg-destructive/10 px-3 py-2.5 text-[12px] font-semibold leading-relaxed text-destructive">
            {error}
          </p>
        ) : null}
        {recoveryFileUri ? (
          <button type="button" onClick={retrySavedReceipt} disabled={busy} className="w-full rounded-xl border border-border bg-white px-3 py-2 text-[12px] font-bold text-foreground disabled:opacity-50">
            {busy ? "Retrying…" : "Retry reading saved receipt"}
          </button>
        ) : null}
        {error && selectedFileRef.current && !recoveryFileUri ? (
          <button type="button" onClick={retrySelectedFile} disabled={busy} className="w-full rounded-xl bg-primary px-3 py-2 text-[12px] font-bold text-primary-foreground disabled:opacity-50">
            {busy ? "Retrying upload and reading…" : "Retry this file"}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-[24px] border border-border bg-secondary/40 px-5 py-6 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-primary shadow-sm">
          {busy ? <Loader2 className="h-7 w-7 animate-spin" /> : <FileText className="h-7 w-7" />}
        </div>
        <h2 className="mt-4 text-[17px] font-extrabold">
          {busy
            ? "Reading your shopping list…"
            : purpose === "priced_list"
              ? "Upload your priced shopping list"
              : "Upload your shopping list"}
        </h2>
        <p className="mx-auto mt-1.5 max-w-[280px] text-[13px] leading-relaxed text-muted-foreground">
          {busy
            ? `Reading item names, quantities and ${purpose === "priced_list" ? "actual shop prices" : "units"} from ${fileName || "your image"}. This takes a few seconds.`
            : purpose === "priced_list"
              ? "Upload the list after the shop has written the prices, or upload the final shop bill."
              : "Upload your list before shopping. Prices are optional; we will estimate them in the next step."}
          {" "}JPG, PNG, WEBP, HEIC and PDF supported.
        </p>

        <div className="mt-4 grid gap-2.5">
          {cameraInput}
          {galleryInput}
        </div>

        <p className="mt-4 inline-flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" /> Receipt file is saved to Drive; nothing is added until you confirm
        </p>
      </div>

      {busy ? (
        <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
          <div className="h-full w-1/2 animate-pulse rounded-full bg-primary" />
        </div>
      ) : null}

      {error ? (
        <p className="rounded-2xl bg-destructive/10 px-4 py-3 text-[13px] font-semibold leading-relaxed text-destructive">
          {error}
        </p>
      ) : null}
      {recoveryFileUri ? (
        <button type="button" onClick={retrySavedReceipt} disabled={busy} className="w-full rounded-full border border-border bg-white px-4 py-3 text-[12.5px] font-bold text-foreground disabled:opacity-50">
          {busy ? "Retrying saved receipt…" : "Retry reading saved receipt"}
        </button>
      ) : null}
      {error && selectedFileRef.current && !recoveryFileUri ? (
        <button type="button" onClick={retrySelectedFile} disabled={busy} className="w-full rounded-full bg-primary px-4 py-3 text-[12.5px] font-bold text-primary-foreground disabled:opacity-50">
          {busy ? "Retrying upload and reading…" : "Retry this file"}
        </button>
      ) : null}
    </div>
  );
}