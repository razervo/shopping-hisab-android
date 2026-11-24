#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
JAVA_ROOT="$APP_DIR/app/src/main/java/com/paddle/ocr"
ASSET_ROOT="$APP_DIR/app/src/main/assets"
PADDLE_COMMIT="dab3fe35379033fdcb2d0e9572fac0b36c9a9ebf"
DET_REVISION="e6f4fa85f00e168c862bc462aebca69eef9b3d3d"
REC_REVISION="3fafbc3b5dcf93dd72add9f48368be8a3a2cd33b"
RAW_BASE="https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/$PADDLE_COMMIT/deploy/ppocr-android/ppocr-sdk/src/main/java/com/paddle/ocr"

mkdir -p "$JAVA_ROOT" "$ASSET_ROOT/models/det" "$ASSET_ROOT/models/rec" "$ASSET_ROOT/third_party"

sources=(
  PaddleOCR.kt
  PaddleOCRConfig.kt
  EngineConfig.kt
  engine/DetectionEngine.kt
  engine/OCREngine.kt
  engine/OCREngineResult.kt
  engine/ORTSessionManager.kt
  engine/RecognitionEngine.kt
  model/ModelConfig.kt
  model/OCRBox.kt
  model/OCRError.kt
  model/OCRResult.kt
  model/OCRRunResult.kt
  postprocess/BoxSorter.kt
  postprocess/CTCDecoder.kt
  postprocess/DBPostProcessor.kt
  postprocess/PolygonUnclip.kt
  postprocess/QuadGeometry.kt
  postprocess/QuadTextCrop.kt
  preprocess/DetPreprocessor.kt
  preprocess/RecPreprocessor.kt
  util/BitmapUtils.kt
  util/ImageUtils.kt
  util/MathUtils.kt
  util/OpenCVUtils.kt
  util/YamlUtils.kt
)

for relative_path in "${sources[@]}"; do
  destination="$JAVA_ROOT/$relative_path"
  mkdir -p "$(dirname "$destination")"
  curl --fail --location --retry 3 --retry-all-errors --connect-timeout 30 --max-time 180 \
    "$RAW_BASE/$relative_path" -o "$destination"
  test -s "$destination"
done

DET="$ASSET_ROOT/models/det/inference.onnx"
REC="$ASSET_ROOT/models/rec/inference.onnx"
REC_CONFIG="$ASSET_ROOT/models/rec/inference.yml"

curl --fail --location --retry 3 --retry-all-errors --connect-timeout 30 --max-time 300 \
  "https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_det_onnx/resolve/$DET_REVISION/inference.onnx?download=true" -o "$DET"
curl --fail --location --retry 3 --retry-all-errors --connect-timeout 30 --max-time 300 \
  "https://huggingface.co/PaddlePaddle/en_PP-OCRv5_mobile_rec_onnx/resolve/$REC_REVISION/inference.onnx?download=true" -o "$REC"
curl --fail --location --retry 3 --retry-all-errors --connect-timeout 30 --max-time 180 \
  "https://huggingface.co/PaddlePaddle/en_PP-OCRv5_mobile_rec_onnx/resolve/$REC_REVISION/inference.yml?download=true" -o "$REC_CONFIG"
curl --fail --location --retry 3 --retry-all-errors --connect-timeout 30 --max-time 180 \
  "https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/$PADDLE_COMMIT/LICENSE" -o "$ASSET_ROOT/third_party/PaddleOCR-LICENSE.txt"

echo "a431985659dc921974177a95adcfbb90fd9e51989a5e04d70d0b75f597b6e61d  $DET" | sha256sum --check -
echo "b5f833dfc5d0eb71da397b4efa06ebeee9b431b690a47d6af40d77d8eabc557f  $REC" | sha256sum --check -
test -s "$REC_CONFIG"
test -s "$ASSET_ROOT/third_party/PaddleOCR-LICENSE.txt"

echo "Prepared pinned PaddleOCR Android SDK and PP-OCRv5 English model assets."
du -h "$DET" "$REC" "$REC_CONFIG"
