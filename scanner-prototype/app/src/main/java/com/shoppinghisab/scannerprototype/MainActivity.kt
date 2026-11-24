package com.shoppinghisab.scannerprototype

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import android.os.Bundle
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.exifinterface.media.ExifInterface
import com.paddle.ocr.EngineConfig
import com.paddle.ocr.PaddleOCR
import com.paddle.ocr.PaddleOCRConfig
import com.paddle.ocr.util.OpenCVUtils
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.util.Locale

class MainActivity : Activity() {
    private val uiScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var ocr: PaddleOCR? = null
    private lateinit var chooseButton: Button
    private lateinit var copyButton: Button
    private lateinit var statusView: TextView
    private lateinit var resultEditor: EditText

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildScreen()
        loadOfflineEngine()
    }

    private fun buildScreen() {
        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(28), dp(20), dp(24))
        }

        page.addView(TextView(this).apply {
            text = "Shopping Hisab · Handwriting Scanner"
            textSize = 23f
        })

        page.addView(TextView(this).apply {
            text = "Offline English handwriting OCR. Choose a clear photo. The app extracts visible text only; it never invents item names, quantities or prices. Check and correct every line before using it."
            textSize = 15f
            setPadding(0, dp(12), 0, dp(18))
        })

        chooseButton = Button(this).apply {
            text = "Choose shopping-list photo"
            isEnabled = false
            setOnClickListener { choosePhoto() }
        }
        page.addView(chooseButton, matchWidth())

        statusView = TextView(this).apply {
            text = "Preparing the on-device OCR engine…"
            textSize = 14f
            setPadding(0, dp(14), 0, dp(12))
        }
        page.addView(statusView)

        page.addView(TextView(this).apply {
            text = "Recognized text (editable)"
            textSize = 18f
        })

        resultEditor = EditText(this).apply {
            hint = "Recognized lines will appear here. You can correct them."
            textSize = 17f
            minLines = 8
            gravity = android.view.Gravity.TOP or android.view.Gravity.START
            setTextIsSelectable(true)
        }
        page.addView(resultEditor, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(260)
        ))

        copyButton = Button(this).apply {
            text = "Copy corrected text"
            isEnabled = false
            setOnClickListener { copyResult() }
        }
        page.addView(copyButton, matchWidth())

        val scroll = ScrollView(this)
        scroll.addView(page)
        setContentView(scroll)
    }

    private fun loadOfflineEngine() {
        uiScope.launch {
            statusView.text = "Loading the bundled OCR models. No network connection is needed."
            try {
                val instance = withContext(Dispatchers.IO) {
                    check(OpenCVUtils.init(applicationContext)) {
                        "OpenCV native library could not be initialized."
                    }
                    PaddleOCR.create(
                        context = applicationContext,
                        config = PaddleOCRConfig(
                            detLimitSideLen = 960,
                            detLimitType = "resize_long",
                            detMaxSideLimit = 1600,
                            recScoreThresh = 0.0f,
                            recBatchSize = 1
                        ),
                        engineConfig = EngineConfig(numThreads = 2),
                        detModelAssetPath = "models/det/inference.onnx",
                        recModelAssetPath = "models/rec/inference.onnx",
                        recConfigAssetPath = "models/rec/inference.yml"
                    )
                }
                ocr = instance
                statusView.text = "Ready. Models are stored inside this app and run on this phone."
                chooseButton.isEnabled = true
            } catch (error: Throwable) {
                statusView.text = "OCR engine could not start: ${error.message ?: error.javaClass.simpleName}"
                chooseButton.isEnabled = false
            }
        }
    }

    private fun choosePhoto() {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "image/*"
        }
        startActivityForResult(intent, REQUEST_IMAGE)
    }

    @Deprecated("Uses the document picker result contract for broad Android compatibility")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQUEST_IMAGE || resultCode != RESULT_OK) return
        val uri = data?.data ?: return
        val engine = ocr ?: return

        chooseButton.isEnabled = false
        copyButton.isEnabled = false
        statusView.text = "Reading photo and recognizing handwriting on this device…"
        resultEditor.setText("")

        uiScope.launch {
            try {
                val bitmap = withContext(Dispatchers.IO) { loadUprightBitmap(uri) }
                val result = try {
                    engine.recognize(bitmap)
                } finally {
                    bitmap.recycle()
                }

                val lines = result.results.map { it.text.trim() }.filter { it.isNotEmpty() }
                resultEditor.setText(lines.joinToString("\n"))
                copyButton.isEnabled = lines.isNotEmpty()

                val scoreNote = if (result.results.isEmpty()) {
                    "No text lines detected."
                } else {
                    val averageScore = result.results.map { it.confidence }.average()
                    "Detected ${result.lineCount} lines · average raw model score ${String.format(Locale.US, "%.2f", averageScore)}."
                }
                statusView.text = "$scoreNote Processing time: ${result.totalTimeMs} ms. The model score is not a guarantee of correctness; review the text."
            } catch (error: Throwable) {
                statusView.text = "Could not read this image: ${error.message ?: error.javaClass.simpleName}"
            } finally {
                chooseButton.isEnabled = ocr != null
            }
        }
    }

    private fun loadUprightBitmap(uri: Uri): Bitmap {
        val bytes = contentResolver.openInputStream(uri)?.use(InputStream::readBytes)
            ?: error("The selected image could not be opened.")
        require(bytes.isNotEmpty()) { "The selected image is empty." }

        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        require(bounds.outWidth > 0 && bounds.outHeight > 0) { "The selected file is not a supported image." }

        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / sample > MAX_IMAGE_SIDE) sample *= 2

        val decoded = BitmapFactory.decodeByteArray(
            bytes, 0, bytes.size,
            BitmapFactory.Options().apply {
                inSampleSize = sample
                inPreferredConfig = Bitmap.Config.ARGB_8888
            }
        ) ?: error("Image decoding failed.")

        val orientation = ExifInterface(ByteArrayInputStream(bytes))
            .getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
        val matrix = Matrix()
        when (orientation) {
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.setScale(-1f, 1f)
            ExifInterface.ORIENTATION_ROTATE_180 -> matrix.setRotate(180f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.setScale(1f, -1f)
            ExifInterface.ORIENTATION_TRANSPOSE -> {
                matrix.setRotate(90f)
                matrix.postScale(-1f, 1f)
            }
            ExifInterface.ORIENTATION_ROTATE_90 -> matrix.setRotate(90f)
            ExifInterface.ORIENTATION_TRANSVERSE -> {
                matrix.setRotate(270f)
                matrix.postScale(-1f, 1f)
            }
            ExifInterface.ORIENTATION_ROTATE_270 -> matrix.setRotate(270f)
        }

        if (matrix.isIdentity) return decoded
        val upright = Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true)
        if (upright !== decoded) decoded.recycle()
        return upright
    }

    private fun copyResult() {
        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText("Shopping Hisab OCR text", resultEditor.text))
        statusView.text = "Corrected text copied. No shopping record has been saved."
    }

    override fun onDestroy() {
        val oldEngine = ocr
        ocr = null
        uiScope.cancel()
        if (oldEngine != null) {
            CoroutineScope(Dispatchers.IO + SupervisorJob()).launch { oldEngine.release() }
        }
        super.onDestroy()
    }

    private fun matchWidth() = LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.WRAP_CONTENT
    )

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    companion object {
        private const val REQUEST_IMAGE = 41
        private const val MAX_IMAGE_SIDE = 2600
    }
}
