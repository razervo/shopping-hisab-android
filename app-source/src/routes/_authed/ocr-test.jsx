import { useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AlertCircle, CheckCircle2, Loader2, ScanText, Upload } from "lucide-react";

export const Route = createFileRoute("/_authed/ocr-test")({
  head: () => ({ meta: [{ title: "Local Handwriting OCR Test · Shopping Hisab" }] }),
  component: LocalOcrTestPage,
});

const MODEL_ID = "Xenova/trocr-small-handwritten";
const TRANSFORMERS_CDN = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";
const MODEL_BASE_URL = "https://huggingface.co/Xenova/trocr-small-handwritten/resolve/main/";

function explainFetchError(error) {
  const message = error?.message || String(error || "Unknown error");
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return "Could not download the OCR engine or model. Check internet access, then reload this page. If the model host is blocked on your network, this browser-only model cannot load from this connection.";
  }
  return message;
}

function segmentHandwrittenLines(image, sourceWidth, sourceHeight) {
  const maxWidth = 1400;
  const scale = Math.min(1, maxWidth / sourceWidth);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);

  // Count dark pixels per row, ignoring a small border to avoid page edges.
  const counts = new Array(height).fill(0);
  const xStart = Math.floor(width * 0.04);
  const xEnd = Math.ceil(width * 0.96);
  for (let y = 0; y < height; y += 1) {
    let dark = 0;
    for (let x = xStart; x < xEnd; x += 2) {
      const i = (y * width + x) * 4;
      const gray = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
      if (gray < 165) dark += 1;
    }
    counts[y] = dark;
  }

  const threshold = Math.max(2, Math.floor((xEnd - xStart) / 900));
  const active = counts.map((count) => count >= threshold);
  const raw = [];
  let start = -1;
  for (let y = 0; y < height; y += 1) {
    if (active[y] && start < 0) start = y;
    if ((!active[y] || y === height - 1) && start >= 0) {
      const end = active[y] ? y + 1 : y;
      if (end - start >= 3) raw.push([start, end]);
      start = -1;
    }
  }

  // Merge nearby ink bands into one text line; split only on clear whitespace.
  const merged = [];
  for (const band of raw) {
    const previous = merged[merged.length - 1];
    if (previous && band[0] - previous[1] <= Math.max(10, Math.round(height * 0.012))) {
      previous[1] = band[1];
    } else {
      merged.push([...band]);
    }
  }

  const lineBands = merged.filter(([a, b]) => b - a >= Math.max(5, Math.round(height * 0.006)));
  if (!lineBands.length) return [];
  return lineBands.slice(0, 40).map(([top, bottom]) => {
    const padY = Math.max(12, Math.round((bottom - top) * 0.55));
    const y = Math.max(0, top - padY);
    const h = Math.min(height - y, bottom - top + padY * 2);
    const crop = document.createElement("canvas");
    crop.width = width;
    crop.height = h;
    const cropCtx = crop.getContext("2d");
    cropCtx.fillStyle = "#fff";
    cropCtx.fillRect(0, 0, width, h);
    cropCtx.drawImage(canvas, 0, y, width, h, 0, 0, width, h);
    return crop.toDataURL("image/png");
  });
}

function LocalOcrTestPage() {
  const [fileUrl, setFileUrl] = useState("");
  const [status, setStatus] = useState("Choose the original handwritten shopping-list photo.");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [lineCount, setLineCount] = useState(0);
  const [modelLoaded, setModelLoaded] = useState(false);
  const imageRef = useRef(null);
  const pipelineRef = useRef(null);
  const inputRef = useRef(null);

  const chooseFile = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !file.type.startsWith("image/")) {
      setError("Choose a JPG, PNG or WEBP image.");
      return;
    }
    if (fileUrl) URL.revokeObjectURL(fileUrl);
    setFileUrl(URL.createObjectURL(file));
    setText("");
    setError("");
    setStatus("Photo loaded. Tap Start local OCR.");
  };

  const runOcr = async () => {
    const image = imageRef.current;
    if (!image) return;
    setBusy(true);
    setError("");
    setText("");
    try {
      if (!pipelineRef.current) {
        setStatus("Loading Transformers.js…");
        const { pipeline, env } = await import(/* @vite-ignore */ TRANSFORMERS_CDN);
        env.allowLocalModels = false;
        env.useBrowserCache = true;
        env.backends.onnx.wasm.numThreads = 1;
        // Avoid the default Hugging Face Xet resolve path; use ordinary model file URLs.
        env.remoteHost = "https://huggingface.co/";
        env.remotePathTemplate = "{model}/resolve/{revision}/";
        setStatus("Downloading handwritten TrOCR model. First download is large; keep this page open…");
        pipelineRef.current = await pipeline("image-to-text", MODEL_ID, {
          revision: "main",
          quantized: true,
          progress_callback: (event) => {
            if (event.status === "progress") {
              setProgress(`${event.file || "Model"}: ${Math.round(event.progress || 0)}%`);
            } else if (event.status) {
              setProgress(event.status);
            }
          },
        });
        setModelLoaded(true);
      }
      setStatus("Finding handwritten lines in the photo…");
      const lines = segmentHandwrittenLines(image, image.naturalWidth, image.naturalHeight);
      if (!lines.length) throw new Error("Could not detect text lines. Try a brighter, straight photo.");
      setLineCount(lines.length);
      const recognised = [];
      for (let i = 0; i < lines.length; i += 1) {
        setStatus(`Recognising line ${i + 1} of ${lines.length}…`);
        const result = await pipelineRef.current(lines[i], { max_new_tokens: 96 });
        const line = result?.[0]?.generated_text?.trim() || "";
        if (line) recognised.push(line);
      }
      const output = recognised.join("\n");
      setText(output);
      setStatus(output ? "Local OCR finished. Check the text carefully." : "No text was recognised.");
    } catch (cause) {
      setError(explainFetchError(cause));
      setStatus("OCR did not finish.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-xl space-y-4 pb-8">
      <div>
        <h1 className="text-2xl font-extrabold">Local handwriting OCR test</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Experimental TrOCR test only. The photo is processed in this browser. The OCR engine and model are downloaded from public model-hosting servers; no image is uploaded to Shopping Hisab.
        </p>
      </div>
      <section className="space-y-3 rounded-2xl border bg-card p-4">
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseFile} className="hidden" />
        <button type="button" onClick={() => inputRef.current?.click()} disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-3 font-semibold">
          <Upload className="h-4 w-4" /> Choose handwritten bill photo
        </button>
        {fileUrl ? (
          <img ref={imageRef} src={fileUrl} alt="Selected handwritten shopping list" className="max-h-96 w-full rounded-xl border object-contain" />
        ) : null}
        <button type="button" onClick={runOcr} disabled={!fileUrl || busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 font-bold text-primary-foreground disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanText className="h-4 w-4" />}
          {busy ? "Processing locally…" : "Start local OCR"}
        </button>
        <p className="text-sm text-muted-foreground">{status}</p>
        {progress ? <p className="text-xs text-muted-foreground">{progress}</p> : null}
        {modelLoaded ? <p className="text-xs text-green-700">Model loaded and cached in this browser where supported.</p> : null}
        {lineCount > 0 ? <p className="text-xs text-muted-foreground">Detected {lineCount} candidate text lines.</p> : null}
        {error ? <p className="flex items-start gap-2 rounded-xl bg-destructive/10 p-3 text-sm text-destructive"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p> : null}
      </section>
      {text ? (
        <section className="space-y-2 rounded-2xl border bg-card p-4">
          <h2 className="flex items-center gap-2 font-bold"><CheckCircle2 className="h-4 w-4 text-green-600" /> Raw TrOCR text</h2>
          <pre className="whitespace-pre-wrap break-words rounded-xl bg-muted p-3 text-sm">{text}</pre>
          <p className="text-xs text-muted-foreground">This is raw OCR output, not yet converted into shopping items. Review recognition accuracy before we connect it to the price-estimation flow.</p>
        </section>
      ) : null}
    </main>
  );
}
