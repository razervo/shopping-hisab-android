#!/usr/bin/env python3
"""Regression tests for safe deletion of empty shopping trips."""

from pathlib import Path
import json
import sqlite3

ROOT = Path(__file__).resolve().parents[1]
db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys = ON")
for migration in sorted((ROOT / "migrations-native").glob("*.sql")):
    db.executescript(migration.read_text(encoding="utf-8"))

db.execute(
    'INSERT INTO "user" (id, name, email) VALUES (?, ?, ?)',
    ("u1", "QA User", "qa@example.test"),
)

child_tables = [
    "shopping_source_lists",
    "shopping_source_lines",
    "shopping_items",
    "shopping_item_sources",
    "shopping_purchase_lines",
    "shopping_actual_bills",
    "shopping_estimates",
    "shopping_estimate_lines",
    "shopping_expense_confirmations",
]


def create_session(session_id, status="open"):
    db.execute(
        """INSERT INTO shopping_sessions
           (id,user_id,name,shopping_date,status,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?)""",
        (session_id, "u1", "QA trip", "2026-11-23", status,
         "2026-11-23T10:00:00Z", "2026-11-23T10:00:00Z"),
    )


def delete_empty_session(session_id, idem_key):
    event_rows = db.execute(
        """SELECT id,entity_type,entity_id,event_type,before_json,after_json,created_at
           FROM shopping_audit_events
           WHERE user_id=? AND session_id=? ORDER BY created_at,id""",
        ("u1", session_id),
    ).fetchall()
    event_fields = ["id", "entity_type", "entity_id", "event_type",
                    "before_json", "after_json", "created_at"]
    snapshot = json.dumps({
        "session": {"id": session_id, "user_id": "u1"},
        "audit_events": [dict(zip(event_fields, row)) for row in event_rows],
    })
    guard_sql = " AND ".join(
        f"NOT EXISTS (SELECT 1 FROM {table} WHERE user_id=? AND session_id=?)"
        for table in child_tables
    )
    guard_values = [value for _ in child_tables for value in ("u1", session_id)]
    insert = db.execute(
        f"""INSERT INTO shopping_session_deletion_log
              (id,user_id,deleted_session_id,idempotency_key,session_snapshot_json,created_at)
            SELECT ?,?,?,?,?,?
            WHERE EXISTS (
              SELECT 1 FROM shopping_sessions
              WHERE id=? AND user_id=? AND status IN ('open','ready_to_confirm')
            ) AND {guard_sql}""",
        ["log-" + session_id, "u1", session_id, idem_key, snapshot,
         "2026-11-23T10:01:00Z", session_id, "u1", *guard_values],
    )
    deleted = db.execute(
        """DELETE FROM shopping_sessions
           WHERE id=? AND user_id=?
             AND EXISTS (
               SELECT 1 FROM shopping_session_deletion_log
               WHERE user_id=? AND deleted_session_id=?
             )""",
        (session_id, "u1", "u1", session_id),
    )
    db.commit()
    return insert.rowcount, deleted.rowcount


# Empty unfinished trip: deletion succeeds and its tombstone retains the audit snapshot.
create_session("empty-trip")
db.execute(
    """INSERT INTO shopping_audit_events
       (id,user_id,session_id,entity_type,entity_id,event_type,after_json,created_at)
       VALUES (?,?,?,?,?,?,?,?)""",
    ("event-empty", "u1", "empty-trip", "session", "empty-trip",
     "session_created", '{"name":"QA trip"}', "2026-11-23T10:00:00Z"),
)
inserted, deleted = delete_empty_session("empty-trip", "delete-empty-1")
assert inserted == 1 and deleted == 1
assert db.execute("SELECT COUNT(*) FROM shopping_sessions WHERE id='empty-trip'").fetchone()[0] == 0
tombstone = db.execute(
    """SELECT session_snapshot_json FROM shopping_session_deletion_log
       WHERE user_id='u1' AND deleted_session_id='empty-trip'"""
).fetchone()
assert tombstone is not None
assert json.loads(tombstone[0])["audit_events"][0]["event_type"] == "session_created"
# Retry after the parent row has cascaded away can still be recognised.
assert db.execute(
    """SELECT 1 FROM shopping_session_deletion_log
       WHERE user_id=? AND deleted_session_id=?""",
    ("u1", "empty-trip"),
).fetchone() is not None

# A trip with even an empty saved list must be protected.
create_session("trip-with-list")
db.execute(
    """INSERT INTO shopping_source_lists
       (id,user_id,session_id,source_type,ocr_status,source_metadata_json,created_at)
       VALUES (?,?,?,?,?,?,?)""",
    ("list-1", "u1", "trip-with-list", "manual_entry",
     "not_applicable", "{}", "2026-11-23T10:00:00Z"),
)
inserted, deleted = delete_empty_session("trip-with-list", "delete-nonempty-1")
assert inserted == 0 and deleted == 0
assert db.execute("SELECT COUNT(*) FROM shopping_sessions WHERE id='trip-with-list'").fetchone()[0] == 1
assert db.execute(
    "SELECT COUNT(*) FROM shopping_session_deletion_log WHERE deleted_session_id='trip-with-list'"
).fetchone()[0] == 0

# A completed trip cannot be deleted, even if it has no child rows.
create_session("finished-trip", status="completed")
empty_guard = " AND ".join(
    f"NOT EXISTS (SELECT 1 FROM {table} WHERE user_id=? AND session_id=?)"
    for table in child_tables
)
guard_values = [value for _ in child_tables for value in ("u1", "finished-trip")]
inserted = db.execute(
    f"""INSERT INTO shopping_session_deletion_log
          (id,user_id,deleted_session_id,idempotency_key,session_snapshot_json,created_at)
        SELECT ?,?,?,?,?,?
        WHERE EXISTS (
          SELECT 1 FROM shopping_sessions
          WHERE id=? AND user_id=? AND status IN ('open','ready_to_confirm')
        ) AND {empty_guard}""",
    ["log-finished", "u1", "finished-trip", "delete-finished",
     "{}", "2026-11-23T10:01:00Z", "finished-trip", "u1", *guard_values],
)
assert inserted.rowcount == 0
assert db.execute("SELECT COUNT(*) FROM shopping_sessions WHERE id='finished-trip'").fetchone()[0] == 1

engine = (ROOT / "src/lib/shopping-engine.server.js").read_text(encoding="utf-8")
assert 'if (!subpath && method === "DELETE")' in engine
assert "shopping_session_deletion_log" in engine
assert "Finished trips are protected and cannot be deleted." in engine
assert "This trip already contains a list, item, estimate or bill." in engine
assert "session_snapshot_json" in engine

detail = (ROOT / "src/routes/_authed/sessions/$sessionId.jsx").read_text(encoding="utf-8")
assert 'method: "DELETE"' in detail
assert 'Idempotency-Key": crypto.randomUUID()' in detail
assert "Delete empty trip" in detail
assert "Edit trip details" in detail

print("PASS: empty trip deletion, retry tombstone, data protection and completed-trip protection.")
