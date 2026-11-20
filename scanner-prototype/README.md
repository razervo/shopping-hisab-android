# Shopping Hisab Handwriting Scanner (isolated Android prototype)

This is a separate native Android scanner test app. It does not change the Shopping
Hisab production TWA, bill reader, Worker, or database.

## OCR engine selection

Uses PaddleOCR's official Android ONNX Runtime SDK with:
- PP-OCRv5 mobile detector (handwriting-capable English text detection).
- PP-OCRv5 mobile English recognizer (the PaddleOCR docs specifically say it improves
  recognition of handwritten English text).
- OpenCV for image handling and ONNX Runtime for local inference.

The English recognizer is chosen because the sample list uses English item names and
Latin-script quantities. This is not a claim of perfect handwriting recognition:
the published 85.25% English recognition figure is a general English benchmark, not
an accuracy guarantee for this user's grocery handwriting. Detection's published
0.777 handwritten-English figure is its text-region detection metric, not character
recognition accuracy.

## Reproducible model build

From this directory run:

```bash
bash scripts/prepare-ppocr.sh
gradle --no-daemon assembleDebug
```

The script fetches source from a pinned PaddleOCR commit and model files from pinned
Hugging Face revisions. It verifies both ONNX model SHA-256 values before the build.
The models are bundled into the APK, so recognition works offline after installation.
The first CI build requires internet access to fetch these pinned files.

## Acceptance behaviour

- Photo text recognition only.
- Results are editable before copying.
- No automatic product interpretation, quantity correction, or price guessing.
- No shopping record is saved by this test app.

## Device requirements

Android 8.0 (API 26) or later. The build uses JDK 17, Kotlin 2.1.0, ONNX Runtime
1.21.1 and OpenCV 4.5.3, matching PaddleOCR's documented Android SDK requirements.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for upstream licenses and pins.


The current CI debug APK is packaged for `arm64-v8a` only to avoid shipping unused x86 and 32-bit OpenCV/ONNX native libraries. Build with the appropriate ABI filter for other test devices.
