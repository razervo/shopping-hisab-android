# Third-party notices — Shopping Hisab Handwriting Scanner

This isolated scanner prototype packages the following components:

- **PaddleOCR Android SDK source** from PaddlePaddle/PaddleOCR commit
  `dab3fe35379033fdcb2d0e9572fac0b36c9a9ebf`, licensed under Apache License 2.0.
  The corresponding license text is bundled at
  `app/src/main/assets/third_party/PaddleOCR-LICENSE.txt`.
- **PP-OCRv5 mobile text detector ONNX model** from
  `PaddlePaddle/PP-OCRv5_mobile_det_onnx`, pinned to revision
  `e6f4fa85f00e168c862bc462aebca69eef9b3d3d`, Apache-2.0.
- **PP-OCRv5 mobile English recognizer ONNX model** from
  `PaddlePaddle/en_PP-OCRv5_mobile_rec_onnx`, pinned to revision
  `3fafbc3b5dcf93dd72add9f48368be8a3a2cd33b`, Apache-2.0.
- **ONNX Runtime Android** 1.21.1, and **OpenCV Android** 4.5.3, distributed under their respective upstream open-source licenses.

Model SHA-256 checks are enforced by `scripts/prepare-ppocr.sh` for both ONNX files.
The build downloads the pinned sources and models during CI; the installed app includes
the model assets and performs OCR on-device. It does not call an OCR service or need
network access for recognition.

This is a handwriting-oriented English recognition choice, not a guarantee that every
handwritten shopping list will be read correctly. Recognition output remains editable,
and quantities/prices are not inferred by this prototype.
