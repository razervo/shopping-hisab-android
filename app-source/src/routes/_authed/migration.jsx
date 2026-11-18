import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Archive, CheckCircle2, ChevronLeft, Loader2, ShieldCheck, UploadCloud } from "lucide-react";
import { unzipSync, strFromU8 } from "fflate";
import { useAuth } from "@/lib/AuthContext";

export const Route = createFileRoute("/_authed/migration")({
  head: () => ({ meta: [{ title: "Import old data · Shopping Hisab" }] }),
  component: MigrationPage,
});

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(options.headers || {}),
    },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || result.message || `Request failed (${response.status})`);
  return result;
}

export function MigrationPage() {
  const { user } = useAuth();
  const [bundle, setBundle] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [summary, setSummary] = useState(null);

  const importBundle = async () => {
    if (!bundle || busy) return;
    setBusy(true);
    setError("");
    setSummary(null);
    try {
      if (bundle.size > 75 * 1024 * 1024) {
        throw new Error("The migration ZIP must be smaller than 75 MB. Export separate smaller batches from the old app.");
      }

      setProgress("Opening and checking the backup…");
      const files = unzipSync(new Uint8Array(await bundle.arrayBuffer()));
      if (!files["manifest.json"]) throw new Error("The ZIP does not contain manifest.json.");
      const manifest = JSON.parse(strFromU8(files["manifest.json"]));
      if (manifest.schema !== "shopping-hisab-migration" || manifest.version !== 1) {
        throw new Error("This is not a supported Shopping Hisab migration backup.");
      }
      if (!Array.isArray(manifest.records) || !Array.isArray(manifest.files)) {
        throw new Error("The backup is missing its records or attachments list.");
      }
      if (manifest.profile?.email && manifest.profile.email.toLowerCase() !== String(user?.email || "").toLowerCase()) {
        throw new Error("This backup belongs to a different email. Sign in to the new app with the same email used in the old app.");
      }

      let importedFiles = 0;
      for (let index = 0; index < manifest.files.length; index += 1) {
        const meta = manifest.files[index];
        setProgress(`Copying private attachments ${index + 1} of ${manifest.files.length}…`);
        const bytes = files[meta.path];
        if (!bytes) throw new Error(`Attachment is missing from the ZIP: ${meta.original_name || meta.path}`);
        const type = String(meta.content_type || "application/octet-stream").toLowerCase();
        const blob = new Blob([bytes], { type });
        const upload = new File([blob], meta.original_name || "attachment", { type });
        const form = new FormData();
        form.set("file", upload, upload.name);
        form.set("legacy_file_uri", String(meta.legacy_file_uri || ""));
        await apiRequest("/api/migration/file", { method: "POST", body: form });
        importedFiles += 1;
      }

      const records = manifest.records;
      if (records.length === 0) {
        setProgress("Importing your profile…");
        await apiRequest("/api/migration/import", {
          method: "POST",
          body: JSON.stringify({ schema: manifest.schema, version: manifest.version, profile: manifest.profile || {}, records: [] }),
        });
      } else {
        for (let offset = 0; offset < records.length; offset += 250) {
          const batch = records.slice(offset, offset + 250);
          setProgress(`Importing shopping records ${Math.min(offset + batch.length, records.length)} of ${records.length}…`);
          await apiRequest("/api/migration/import", {
            method: "POST",
            body: JSON.stringify({
              schema: manifest.schema,
              version: manifest.version,
              profile: offset === 0 ? (manifest.profile || {}) : null,
              records: batch,
            }),
          });
        }
      }

      setProgress("Checking the imported data…");
      const result = await apiRequest("/api/migration/status");
      setSummary({ ...result, files_in_backup: importedFiles, records_in_backup: records.length });
      setProgress("Import completed.");
    } catch (cause) {
      setError(cause.message || "Import failed. Your old Base44 data remains unchanged. You can retry this ZIP.");
      setProgress("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-5 pb-8">
      <Link to="/profile" className="inline-flex items-center gap-1 text-[13px] font-semibold text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> Back to profile
      </Link>

      <div className="rounded-[26px] bg-primary px-5 py-6 text-primary-foreground">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15">
            <Archive className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-[21px] font-extrabold">Move your old shopping data</h1>
            <p className="mt-1 text-[12px] text-white/75">Import a backup from your previous Shopping Hisab account</p>
          </div>
        </div>
      </div>

      <div className="space-y-3 rounded-[24px] border border-border bg-white p-4">
        <div className="flex items-start gap-2.5">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div className="text-[12.5px] leading-relaxed text-muted-foreground">
            Your backup is imported into your signed-in account. Records and attachments are private to your account. This process does not delete or change anything in the old Base44 app.
          </div>
        </div>
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-secondary/40 px-4 py-8 text-center">
          <UploadCloud className="h-8 w-8 text-primary" />
          <span className="text-[14px] font-bold">Choose migration ZIP</span>
          <span className="text-[11.5px] text-muted-foreground">Shopping-Hisab-migration.zip · up to 75 MB</span>
          <input
            type="file"
            accept=".zip,application/zip"
            className="sr-only"
            disabled={busy}
            onChange={(event) => {
              setBundle(event.currentTarget.files?.[0] || null);
              setError("");
              setSummary(null);
              event.currentTarget.value = "";
            }}
          />
        </label>
        {bundle ? <p className="text-[12px] font-semibold">{bundle.name} · {(bundle.size / 1024 / 1024).toFixed(1)} MB</p> : null}
        <button
          type="button"
          onClick={importBundle}
          disabled={!bundle || busy}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-primary px-5 py-3.5 text-[14px] font-bold text-primary-foreground disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}
          {busy ? "Importing…" : "Import backup"}
        </button>
        {progress ? <p className="text-center text-[12px] font-semibold text-primary">{progress}</p> : null}
        {error ? <p className="rounded-xl bg-destructive/10 px-3 py-2.5 text-[12px] font-semibold text-destructive">{error}</p> : null}
      </div>

      {summary ? (
        <div className="space-y-2 rounded-[24px] border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
          <div className="flex items-center gap-2 font-extrabold">
            <CheckCircle2 className="h-5 w-5" /> Migration import finished
          </div>
          <p className="text-[13px]">Shopping records in Cloudflare: <strong>{summary.imported_records}</strong></p>
          <p className="text-[13px]">Private attachments in Cloudflare: <strong>{summary.imported_files}</strong></p>
          <p className="text-[11px] leading-relaxed text-emerald-800">Open History and Reports to reconcile totals with your old account before switching over.</p>
        </div>
      ) : null}
    </div>
  );
}
