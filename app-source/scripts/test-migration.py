#!/usr/bin/env python3
"""Regression coverage for Base44-to-native data import idempotency and isolation."""

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
start = source.index("async function handleMigrationImport(")
end = source.index("async function handleMigrationFile(", start)
import_handler = source[start:end]
assert "body?.schema !== \"shopping-hisab-migration\"" in import_handler
assert "body?.version !== 1" in import_handler
assert "Sign in with the same email before importing." in import_handler
assert "ON CONFLICT(user_id, legacy_base44_id) DO UPDATE SET" in import_handler
assert "await env.DB.batch(statements.slice(i, i + 50))" in import_handler
assert "Existing Base44 data has not been changed." in import_handler
assert "name = COALESCE(NULLIF(?, ''), name)" in import_handler
assert "displayName = COALESCE(NULLIF(?, ''), displayName)" in import_handler
assert "phone = COALESCE(NULLIF(?, ''), phone)" in import_handler
assert "preferredMarket = COALESCE(NULLIF(?, ''), preferredMarket)" in import_handler

file_handler = source[end:source.index("export async function handleNativeApi(", end)]
assert "SELECT id FROM uploaded_files WHERE user_id = ? AND legacy_file_uri = ?" in file_handler
assert "if (existing)" in file_handler
assert "legacy-file:" in file_handler
assert "uploadGoogleDriveFile(env.DB, user.id, env, file, originalName, uploadKey)" in file_handler

def import_record(user_id, legacy_id, shop, date, total, items_json, updated_at):
    db.execute(
        """INSERT INTO shopping_records
           (id,user_id,shop_name,date,items_json,total,item_count,notes,source,
            bill_file_id,legacy_bill_file_uri,legacy_base44_id,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,'','manual',NULL,NULL,?,?,?)
           ON CONFLICT(user_id, legacy_base44_id) DO UPDATE SET
             shop_name=excluded.shop_name,
             date=excluded.date,
             items_json=excluded.items_json,
             total=excluded.total,
             item_count=excluded.item_count,
             notes=excluded.notes,
             source=excluded.source,
             bill_file_id=excluded.bill_file_id,
             legacy_bill_file_uri=excluded.legacy_bill_file_uri,
             updated_at=excluded.updated_at""",
        ("native-" + user_id + "-" + legacy_id, user_id, shop, date,
         items_json, total, 2, legacy_id, "2026-11-01T10:00:00Z", updated_at),
    )

# Reimport of the same legacy record updates the row rather than creating a
# duplicate; its original native ID remains stable.
import_record("u1", "base44-record-001", "Old Shop", "2026-11-01", 100.0,
              '[{"name":"Rice","qty":1,"unit":"kg","amount":100}]',
              "2026-11-01T10:00:00Z")
first_id = db.execute(
    "SELECT id FROM shopping_records WHERE user_id=? AND legacy_base44_id=?",
    ("u1", "base44-record-001"),
).fetchone()[0]
import_record("u1", "base44-record-001", "Corrected Shop", "2026-11-02", 120.0,
              '[{"name":"Rice","qty":1,"unit":"kg","amount":120}]',
              "2026-11-03T10:00:00Z")
row = db.execute(
    "SELECT id,shop_name,date,total,legacy_base44_id FROM shopping_records WHERE user_id=? AND legacy_base44_id=?",
    ("u1", "base44-record-001"),
).fetchone()
assert row == (first_id, "Corrected Shop", "2026-11-02", 120.0, "base44-record-001")
assert db.execute(
    "SELECT COUNT(*) FROM shopping_records WHERE user_id='u1' AND legacy_base44_id='base44-record-001'"
).fetchone()[0] == 1

# A different user's import with the same legacy source ID is separate.
import_record("u2", "base44-record-001", "User Two Shop", "2026-11-04", 80.0,
              '[{"name":"Dal","qty":1,"unit":"kg","amount":80}]',
              "2026-11-04T10:00:00Z")
assert db.execute(
    "SELECT COUNT(*) FROM shopping_records WHERE legacy_base44_id='base44-record-001'"
).fetchone()[0] == 2
assert db.execute(
    "SELECT shop_name FROM shopping_records WHERE user_id='u2' AND legacy_base44_id='base44-record-001'"
).fetchone()[0] == "User Two Shop"

# Attachment metadata lookup is scoped to the importing user; the same
# Base44 URI can be linked to two different user's independent Drive files.
db.executemany(
    """INSERT INTO uploaded_files
       (id,user_id,r2_key,storage_provider,drive_file_id,original_name,content_type,size_bytes,legacy_file_uri)
       VALUES (?,?,?,?,?,?,?,?,?)""",
    [
        ("file-u1", "u1", "drive:file-u1", "google_drive", "drive-u1",
         "bill.jpg", "image/jpeg", 1000, "https://base44.example/file/1"),
        ("file-u2", "u2", "drive:file-u2", "google_drive", "drive-u2",
         "bill.jpg", "image/jpeg", 1000, "https://base44.example/file/1"),
    ],
)
assert db.execute(
    "SELECT id FROM uploaded_files WHERE user_id=? AND legacy_file_uri=?",
    ("u1", "https://base44.example/file/1"),
).fetchone()[0] == "file-u1"
assert db.execute(
    "SELECT id FROM uploaded_files WHERE user_id=? AND legacy_file_uri=?",
    ("u2", "https://base44.example/file/1"),
).fetchone()[0] == "file-u2"

violations = db.execute("PRAGMA foreign_key_check").fetchall()
assert not violations, f"Foreign key violations: {violations}"
print("Migration checks passed: reimport idempotency, stable record IDs, per-user record isolation and per-user attachment mapping.")
