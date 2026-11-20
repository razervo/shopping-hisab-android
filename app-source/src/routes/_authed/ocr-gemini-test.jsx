import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Upload, ScanText } from "lucide-react";

export const Route = createFileRoute("/_authed/ocr-gemini-test")({
  head: () => ({ meta: [{ title: "Gemini OCR Test · Shopping Hisab" }] }),
  component: GeminiOcrTestPage,
});

function GeminiOcrTestPage() {
  const [file, setFile] = useState(null);
  const [purpose, setPurpose] = useState("shopping_list");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  async function runTest() {
    if (!file) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("purpose", purpose);
      const response = await fetch("/api/ai/gemini-test", {
        method: "POST",
        body: form,
        credentials: "include",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Gemini test failed.");
      setResult(data);
    } catch (cause) {
      setError(cause?.message || "Could not complete the Gemini test.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-xl space-y-4 pb-8">
      <div>
        <h1 className="text-2xl font-extrabold">Gemini handwriting OCR test</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Separate test only. This does not replace the production bill reader. The image is sent to Gemini and the original is saved to your connected Google Drive.
        </p>
        <p className="mt-2 rounded-lg border p-3 text-xs text-muted-foreground">
          Gemini API free-tier requests may be used by Google to improve its products. Do not test with sensitive documents.
        </p>
      </div>
      <section className="space-y-3 rounded-2xl border bg-card p-4">
        <label className="block text-sm font-semibold">Photo (JPG, PNG or WEBP)</label>
        <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { setFile(event.target.files?.[0] || null); setResult(null); setError(""); }} className="block w-full text-sm" />
        <label className="block text-sm font-semibold">What are we reading?</label>
        <select value={purpose} onChange={(event) => setPurpose(event.target.value)} className="w-full rounded-lg border bg-background p-3 text-sm">
          <option value="shopping_list">Shopping list (before shopping)</option>
          <option value="priced_list">Priced list (actual prices)</option>
        </select>
        {file ? <p className="text-xs text-muted-foreground">{file.name} · {(file.size / 1024).toFixed(0)} KB</p> : null}
        <button type="button" onClick={runTest} disabled={!file || busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 font-bold text-primary-foreground disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanText className="h-4 w-4" />}
          {busy ? "Reading with Gemini…" : "Test Gemini OCR"}
        </button>
        {error ? <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
      </section>
      {result ? (
        <section className="space-y-3 rounded-2xl border bg-card p-4">
          <h2 className="font-bold">Recognition result</h2>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-muted p-2"><div className="text-lg font-bold">{(result.timing.gemini_ms / 1000).toFixed(1)}s</div><div className="text-xs text-muted-foreground">Gemini</div></div>
            <div className="rounded-lg bg-muted p-2"><div className="text-lg font-bold">{(result.timing.drive_upload_ms / 1000).toFixed(1)}s</div><div className="text-xs text-muted-foreground">Drive save</div></div>
            <div className="rounded-lg bg-muted p-2"><div className="text-lg font-bold">{(result.timing.total_ms / 1000).toFixed(1)}s</div><div className="text-xs text-muted-foreground">Total</div></div>
          </div>
          <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-3 text-xs">{JSON.stringify(result.draft, null, 2)}</pre>
          <p className="text-xs text-muted-foreground">Original photo saved to your connected Google Drive. File reference: {result.file_uri}</p>
        </section>
      ) : null}
    </main>
  );
}
