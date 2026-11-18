import { useState } from "react";
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

  const handleFile = async (picked) => {
    if (!picked) return;
    setError("");
    if (!isAcceptedBill(picked)) {
      setError("Please choose a valid JPG, PNG, WEBP, HEIC photo or PDF bill.");
      return;
    }
    if (!picked.size) {
      setError("The selected file is empty. Please take another photo or choose another file.");
      return;
    }

    setFileName(picked.name);
    setBusy(true);

    let file;
    try {
      file = await prepareBillFile(picked);
    } catch {
      file = picked;
    }

    if (file.size > BILL_MAX_BYTES) {
      setError("That file is too large. Please use a photo or PDF under 10 MB.");
      setBusy(false);
      return;
    }

    let fileUri = "";
    try {
      const uploaded = await base44.integrations.Core.UploadPrivateFile({ file });
      fileUri = uploaded?.file_uri || "";
      if (!fileUri) throw new Error("no file uri");
    } catch {
      setError("The bill could not be uploaded. Check your internet connection and try again.");
      setBusy(false);
      return;
    }

    try {
      const result = await readShoppingBill({ data: { fileUri, purpose } });
      if (result?.draft) {
        onExtracted(result.draft, fileUri);
      } else {
        setError(
          result?.error ||
            "We could not read this bill. Try a clearer, straight photo, or enter the items manually.",
        );
      }
    } catch {
      setError("We could not read this bill. Please try again or enter the items manually.");
    } finally {
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
      <span className="pointer-events-none flex items-center justify-center gap-2 rounded-full bg-primary px-4 py-3 text-[12.5px] font-bold text-primary-foreground">
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
      <span className="pointer-events-none flex items-center justify-center gap-2 rounded-full border border-border bg-white px-4 py-3 text-[12.5px] font-bold text-foreground">
        <ImageUp className="h-4 w-4" /> Gallery / PDF
      </span>
    </label>
  );

  if (compact) {
    return (
      <div className="space-y-3 rounded-[20px] border border-border bg-white p-3">
        <div className="flex items-start gap-2">
          <FileText className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div>
            <p className="text-[12.5px] font-extrabold">Upload the list with shop prices</p>
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
              Take a photo of the same list after writing the actual shop prices, or upload the final bill. We will match the item names and update the rates.
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
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-[28px] border border-border bg-secondary/40 px-6 py-8 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-white text-primary shadow-sm">
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

        <div className="mt-5 grid gap-2.5">
          {cameraInput}
          {galleryInput}
        </div>

        <p className="mt-4 inline-flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" /> Nothing is saved until you confirm the details
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
    </div>
  );
}