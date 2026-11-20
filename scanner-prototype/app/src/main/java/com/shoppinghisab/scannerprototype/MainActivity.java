package com.shoppinghisab.scannerprototype;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;
import java.io.InputStream;

public class MainActivity extends Activity {
    private static final int PICK_IMAGE = 41;
    private TextView status;
    private TextView result;
    private Button scanButton;
    private TextRecognizer recognizer;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setPadding(28, 36, 28, 24);
        page.setBackgroundColor(Color.WHITE);

        TextView title = new TextView(this);
        title.setText("Shopping Hisab · Scanner Lab");
        title.setTextSize(23);
        title.setTextColor(Color.rgb(25, 80, 55));
        page.addView(title);

        TextView intro = new TextView(this);
        intro.setText("Choose a clear photo of your handwritten shopping list. Recognition runs on this Android device. This prototype extracts text only; it does not guess quantities or prices.");
        intro.setTextSize(15);
        intro.setPadding(0, 18, 0, 18);
        page.addView(intro);

        scanButton = new Button(this);
        scanButton.setText("Choose shopping-list photo");
        scanButton.setOnClickListener(v -> {
            Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
            intent.setType("image/*");
            startActivityForResult(Intent.createChooser(intent, "Select shopping list"), PICK_IMAGE);
        });
        page.addView(scanButton);

        status = new TextView(this);
        status.setText("Ready. Select a photo to begin.");
        status.setTextSize(14);
        status.setPadding(0, 18, 0, 12);
        page.addView(status);

        result = new TextView(this);
        result.setTextSize(17);
        result.setTextColor(Color.BLACK);
        result.setTextIsSelectable(true);
        result.setPadding(0, 8, 0, 20);
        page.addView(result, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        ScrollView scroll = new ScrollView(this);
        scroll.addView(page);
        setContentView(scroll);
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != PICK_IMAGE || resultCode != RESULT_OK || data == null || data.getData() == null) return;
        Uri uri = data.getData();
        scanButton.setEnabled(false);
        status.setText("Preparing image and recognising text on this device…");
        result.setText("");
        try {
            InputImage image = InputImage.fromFilePath(this, uri);
            recognizer.process(image)
                .addOnSuccessListener(text -> {
                    StringBuilder lines = new StringBuilder();
                    for (Text.TextBlock block : text.getTextBlocks()) {
                        for (Text.Line line : block.getLines()) {
                            if (lines.length() > 0) lines.append("\n");
                            lines.append(line.getText());
                        }
                    }
                    result.setText(lines.length() == 0 ? "No text detected. Try a brighter, closer photo." : lines.toString());
                    status.setText("Finished. Check every line carefully; handwriting may be misread.");
                    scanButton.setEnabled(true);
                })
                .addOnFailureListener(error -> {
                    status.setText("Recognition failed: " + error.getLocalizedMessage());
                    scanButton.setEnabled(true);
                });
        } catch (Exception error) {
            status.setText("Could not open image: " + error.getLocalizedMessage());
            scanButton.setEnabled(true);
        }
    }

    @Override protected void onDestroy() {
        if (recognizer != null) recognizer.close();
        super.onDestroy();
    }
}
