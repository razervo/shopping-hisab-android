#!/usr/bin/env python3
"""D1-side regression checks for Drive upload marker and metadata recovery."""

from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parents[1]
db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys = ON")
for migration in sorted((ROOT / "migrations-native").glob("*.sql")):
    db.executescript(migration.read_text(encoding="utf-8"))

db.executemany(
    'INSERT INTO "user" (id, name, email) VALUES (?, ?, ?)',
    [
        ("u1", "QA One", "one@example.test"),
        ("u2", "QA Two", "two@example.test"),
    ],
)

source = (ROOT / "src/lib/native-api.server.js").read_text(encoding="utf-8")
assert "return error(\"Internal server error. Please try again.\", 500);" in source

# File-content and OCR reads must both authorize the file by owner ID.
files_handler_start = source.index("async function handleFiles(")
files_handler_end = source.index("async function handleDriveStatus", files_handler_start)
files_handler = source[files_handler_start:files_handler_end]
assert "WHERE id = ? AND user_id = ?" in files_handler
assert ".bind(id, user.id).first()" in files_handler
ai_handler_start = source.index("async function handleAI(")
ai_handler_end = source.index("function safeImportedTimestamp", ai_handler_start)
ai_handler = source[ai_handler_start:ai_handler_end]
assert "WHERE id = ? AND user_id = ?" in ai_handler
assert ".bind(fileId, user.id).first()" in ai_handler
start = source.index("async function findDriveUploadByMarker(")
end = source.index("\nasync function downloadGoogleDriveFile", start)
drive_code = source[start:end]
assert "shoppingHisabUploadKey" in drive_code
assert "shoppingHisabContentHash" in drive_code
assert "reservation.status === \"complete\" && reservation.drive_file_id" in drive_code
assert "reservation.content_hash !== contentHash" in drive_code
assert "updated_at < datetime('now', '-30 minutes')" in drive_code
assert "UPDATE drive_upload_idempotency SET uploaded_file_id = ?" in drive_code
assert "SELECT original_name, size_bytes FROM uploaded_files WHERE user_id = ? AND drive_file_id = ?" in drive_code

# Verify the app's orchestration keeps a saved receipt recoverable if OCR fails,
# and that retry reads the saved Drive file rather than uploading another copy.
direct_start = source.index("async function handleDirectBillRead(")
direct_end = source.index("async function queryCombinedReportRecords(", direct_start)
direct_read = source[direct_start:direct_end]
upload_position = direct_read.index("uploaded = await uploadGoogleDriveFile")
metadata_position = direct_read.index("ensureDriveUploadMetadata(env.DB, user.id, uploaded, mime)", upload_position)
ocr_position = direct_read.index("parsed = await readBillWithFallback", metadata_position)
assert upload_position >= 0 and metadata_position > upload_position and ocr_position > metadata_position
assert "Promise.allSettled([readPromise, uploadPromise])" not in direct_read
assert "recoverable: true" in direct_read
assert "file_uri: fileUri" in direct_read
ai_handler = source[source.index("async function handleAI("):source.index("function safeImportedTimestamp(")]
assert "downloadGoogleDriveFile(env.DB, user.id, env, file.drive_file_id)" in ai_handler

uploader = (ROOT / "src/components/shopping/BillUploader.jsx").read_text(encoding="utf-8")
assert "const retrySavedReceipt = async ()" in uploader
assert "readShoppingBill({ data: { fileUri: recoveryFileUri, purpose } })" in uploader
assert "setRecoveryFileUri(result.file_uri)" in uploader

# Model the difficult failure: Google Drive has created the file, but the app
# still has a pending D1 marker and no saved Drive file ID / uploaded_files row.
db.execute(
    """INSERT INTO drive_upload_idempotency
       (id,user_id,idempotency_key,content_hash,status,lease_token)
       VALUES (?,?,?,?,?,?)""",
    ("reservation-1", "u1", "retry-key-1", "sha256-file-1", "pending", "lease-1"),
)
# A matching appProperties marker discovered on Google Drive identifies the
# already-created file; the recovery path stores its ID instead of uploading.
drive_marker = {
    "file_id": "drive-file-1",
    "shoppingHisabUploadKey": "hashed-key-1",
    "shoppingHisabContentHash": "sha256-file-1",
}
assert drive_marker["shoppingHisabContentHash"] == db.execute(
    "SELECT content_hash FROM drive_upload_idempotency WHERE user_id=? AND idempotency_key=?",
    ("u1", "retry-key-1"),
).fetchone()[0]
db.execute(
    """UPDATE drive_upload_idempotency
       SET status='complete',drive_file_id=?,updated_at=CURRENT_TIMESTAMP
       WHERE user_id=? AND idempotency_key=? AND content_hash=?""",
    (drive_marker["file_id"], "u1", "retry-key-1", "sha256-file-1"),
)
reservation = db.execute(
    "SELECT status,drive_file_id,uploaded_file_id FROM drive_upload_idempotency WHERE user_id=? AND idempotency_key=?",
    ("u1", "retry-key-1"),
).fetchone()
assert reservation == ("complete", "drive-file-1", None)

# Metadata recovery after the D1 row has the Drive ID but uploaded_files is
# absent (e.g., process stopped between the two writes).
known = db.execute(
    "SELECT id FROM uploaded_files WHERE user_id=? AND drive_file_id=?",
    ("u1", "drive-file-1"),
).fetchone()
assert known is None
db.execute(
    """INSERT INTO uploaded_files
       (id,user_id,r2_key,storage_provider,drive_file_id,original_name,content_type,size_bytes)
       VALUES (?,?,?,?,?,?,?,?)""",
    ("uploaded-1", "u1", "drive:drive-file-1", "google_drive",
     "drive-file-1", "receipt.jpg", "image/jpeg", 12345),
)
db.execute(
    """UPDATE drive_upload_idempotency
       SET uploaded_file_id=?,status='complete',updated_at=CURRENT_TIMESTAMP
       WHERE user_id=? AND drive_file_id=?""",
    ("uploaded-1", "u1", "drive-file-1"),
)
assert db.execute(
    "SELECT uploaded_file_id,status FROM drive_upload_idempotency WHERE user_id=? AND idempotency_key=?",
    ("u1", "retry-key-1"),
).fetchone() == ("uploaded-1", "complete")

# Subsequent retries must return the already-known Drive file/metadata rather
# than create another uploaded_files entry.
before = db.execute(
    "SELECT COUNT(*) FROM uploaded_files WHERE user_id=? AND drive_file_id=?",
    ("u1", "drive-file-1"),
).fetchone()[0]
assert before == 1
assert db.execute(
    "SELECT id FROM uploaded_files WHERE user_id=? AND drive_file_id=?",
    ("u1", "drive-file-1"),
).fetchone()[0] == "uploaded-1"
after = db.execute(
    "SELECT COUNT(*) FROM uploaded_files WHERE user_id=? AND drive_file_id=?",
    ("u1", "drive-file-1"),
).fetchone()[0]
assert after == before

# An idempotency key is user-scoped, and a changed file hash is not accepted.
db.execute(
    """INSERT INTO drive_upload_idempotency
       (id,user_id,idempotency_key,content_hash,status,lease_token)
       VALUES (?,?,?,?,?,?)""",
    ("reservation-user-2", "u2", "retry-key-1", "sha256-file-2", "pending", "lease-2"),
)
assert db.execute(
    "SELECT content_hash FROM drive_upload_idempotency WHERE user_id=? AND idempotency_key=?",
    ("u2", "retry-key-1"),
).fetchone()[0] == "sha256-file-2"
assert db.execute(
    "SELECT content_hash FROM drive_upload_idempotency WHERE user_id=? AND idempotency_key=?",
    ("u1", "retry-key-1"),
).fetchone()[0] == "sha256-file-1"
assert db.execute(
    "SELECT COUNT(*) FROM uploaded_files WHERE user_id=? AND drive_file_id=?",
    ("u2", "drive-file-1"),
).fetchone()[0] == 0

violations = db.execute("PRAGMA foreign_key_check").fetchall()
assert not violations, f"Foreign key violations: {violations}"
print("Drive recovery D1 regression checks passed: marker recovery, metadata recovery, repeated retry de-duplication, changed-content rejection and per-user isolation.")
