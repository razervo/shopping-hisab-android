import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Archive, CheckCircle2, ChevronLeft, Download, Loader2, ShieldCheck } from "lucide-react";
import { strToU8, zipSync } from "fflate";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";

export const Route = createFileRoute("/_authed/export-migration")({
  head: () => ({ meta: [{ title: "Export migration backup · Shopping Hisab" }] }),
  component: ExportMigrationPage,
});

const PAGE_SIZE = 500;
const MAX_RECORD_PAGES = 400;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 70 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

function safeName(value) {
  return String(value || "attachment")
    .replace(/[\\/\\0-\\x1f]/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 100) || "attachment";
}

function extensionFor(type) {
  return ({
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "application/pdf": "pdf",
  })[type] || "bin";
}

function filenameFrom(uri, index, type) {
  try {
    const last = new URL(uri).pathname.split("/").filter(Boolean).pop();
    if (last && /\.[a-z0-9]{2,5}$/i.test(last)) return safeName(decodeURIComponent(last));
  } catch {
    // Base44 private file URIs may not be absolute URLs.
  }
  return `attachment-${index + 1}.${extensionFor(type)}`;
}

async function fetchAllRecords(setProgress) {
  const records = [];
  for (let pageNumber = 0; pageNumber < MAX_RECORD_PAGES; pageNumber += 1) {
    const skip = pageNumber * PAGE_SIZE;
    setProgress(`Reading shopping records · page ${pageNumber + 1}…`);
    // Base44 SDK list() returns an array and uses positional sort, limit, skip arguments.
    const page = await base44.entities.ShoppingRecord.list("-date", PAGE_SIZE, skip);
    if (!Array.isArray(page)) {
      throw new Error("Base44 returned an unexpected records response. No backup was created.");
    }
    records.push(...page);
    if (page.length < PAGE_SIZE) return records;
  }
  throw new Error("This account has more than 200,000 records. Export in smaller date ranges with a supported export tool.");
}

async function downloadPrivateFile(fileUri, index, setProgress) {
  setProgress(`Downloading private attachment ${index + 1}…`);
  const signed = await base44.integrations.Core.CreateFileSignedUrl({
    file_uri: fileUri,
    expires_in: 600,
  });
  if (!signed?.signed_url) throw new Error(`Base44 did not provide a download link for attachment ${index + 1}.`);

  const response = await fetch(signed.signed_url);
  if (!response.ok) throw new Error(`Could not download private attachment ${index + 1} (HTTP ${response.status}).`);
  const blob = await response.blob();
  const type = String(blob.type || response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!ACCEPTED_TYPES.has(type)) {
    throw new Error(`Attachment ${index + 1} has unsupported type "${type || "unknown"}". The native importer accepts JPG, PNG, WEBP and PDF; no files were skipped silently.`);
  }
  if (!blob.size) throw new Error(`Attachment ${index + 1} downloaded empty.`);
  if (blob.size > MAX_FILE_BYTES) {
    throw new Error(`Attachment ${index + 1} is larger than 10 MB. The Cloudflare importer accepts up to 10 MB per file, so no backup was created.`);
  }
  return { bytes: new Uint8Array(await blob.arrayBuffer()), type, size: blob.size };
}

function saveZip(bytes) {
  const blob = new Blob([bytes], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "Shopping-Hisab-migration.zip";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function ExportMigrationPage() {
  const { user, isLoadingAuth } = useAuth();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const createBackup = async () => {
    if (busy || !user?.email) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const records = await fetchAllRecords(setProgress);
      const fileUris = new Set();
      for (const record of records) {
        if (record?.bill_file_uri) fileUris.add(String(record.bill_file_uri));
      }
      if (user.profile_picture_uri) fileUris.add(String(user.profile_picture_uri));

      const files = {};
      const fileManifest = [];
      let totalBytes = 0;
      let index = 0;
      for (const uri of fileUris) {
        const downloaded = await downloadPrivateFile(uri, index, setProgress);
        totalBytes += downloaded.size;
        if (totalBytes > MAX_TOTAL_BYTES) {
          throw new Error("Attachments exceed 70 MB. This single ZIP would be too large; use a smaller date-range export.");
        }
        const originalName = filenameFrom(uri, index, downloaded.type);
        const path = `files/${String(index + 1).padStart(4, "0")}-${originalName}`;
        files[path] = downloaded.bytes;
        fileManifest.push({
          path,
          content_type: downloaded.type,
          original_name: originalName,
          legacy_file_uri: uri,
          size: downloaded.size,
        });
        index += 1;
      }

      setProgress("Packing the complete backup…");
      const manifest = {
        schema: "shopping-hisab-migration",
        version: 1,
        exported_at: new Date().toISOString(),
        profile: {
          email: user.email,
          display_name: user.display_name || "",
          full_name: user.full_name || "",
          phone: user.phone || "",
          preferred_market: user.preferred_market || "",
          profile_picture_uri: user.profile_picture_uri || "",
        },
        records,
        files: fileManifest,
      };
      files["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
      const zipped = zipSync(files, { level: 6 });
      if (zipped.byteLength > 75 * 1024 * 1024) {
        throw new Error("The completed ZIP exceeds the new app's 75 MB import limit. Export a smaller backup.");
      }
      saveZip(zipped);
      setResult({ records: records.length, attachments: fileManifest.length, size: zipped.byteLength });
      setProgress("Backup created. Keep this ZIP safe until migration is fully reconciled.");
    } catch (cause) {
      setError(cause?.message || "Backup failed. Your old Base44 data was not changed.");
      setProgress("");
    } finally {
      setBusy(false);
    }
  };

  if (isLoadingAuth) return <div className="p-6 text-sm text-muted-foreground">Checking your account…</div>;
  if (!user) return <div className="p-6 text-sm text-muted-foreground">Sign in to the old Shopping Hisab account to export its data.</div>;

  return (
    <div className="mx-auto max-w-xl space-y-5 pb-8">
      <Link to="/profile" className="inline-flex items-center gap-1 text-[13px] font-semibold text-muted-foreground">
        <ChevronLeft className="h-4 w-4" /> Back to profile
      </Link>
      <div className="rounded-[26px] bg-primary px-5 py-6 text-primary-foreground">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15"><Archive className="h-6 w-6" /></div>
          <div>
            <h1 className="text-[21px] font-extrabold">Export your old data</h1>
            <p className="mt-1 text-[12px] text-white/75">Create a full backup for the Cloudflare version</p>
          </div>
        </div>
      </div>
      <div className="space-y-3 rounded-[24px] border border-border bg-white p-4">
        <div className="flex items-start gap-2.5 text-[12.5px] leading-relaxed text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          This reads records visible to your signed-in account and downloads private bills/profile photo using Base44 signed links. It does not edit or delete old records.
        </div>
        <p className="text-[12px] text-muted-foreground">Signed in as <strong className="text-foreground">{user.email}</strong></p>
        <button type="button" onClick={createBackup} disabled={busy || !user.email} className="flex w-full items-center justify-center gap-2 rounded-full bg-primary px-5 py-3.5 text-[14px] font-bold text-primary-foreground disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {busy ? "Preparing backup…" : "Create migration ZIP"}
        </button>
        {progress ? <p className="text-center text-[12px] font-semibold text-primary">{progress}</p> : null}
        {error ? <p className="rounded-xl bg-destructive/10 px-3 py-2.5 text-[12px] font-semibold text-destructive">{error}</p> : null}
      </div>
      {result ? (
        <div className="space-y-2 rounded-[24px] border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
          <div className="flex items-center gap-2 font-extrabold"><CheckCircle2 className="h-5 w-5" /> Backup ready</div>
          <p className="text-[13px]">Shopping records: <strong>{result.records}</strong></p>
          <p className="text-[13px]">Private attachments: <strong>{result.attachments}</strong></p>
          <p className="text-[13px]">ZIP size: <strong>{(result.size / 1024 / 1024).toFixed(2)} MB</strong></p>
          <p className="text-[11px] leading-relaxed">Do not delete the old app or its data. First import this ZIP into the test Cloudflare app and compare record counts, totals and receipts.</p>
        </div>
      ) : null}
    </div>
  );
}
