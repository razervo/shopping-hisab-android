#!/usr/bin/env python3
"""Regression test for idempotent final expense confirmation under retries/races."""

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
db.execute(
    """INSERT INTO shopping_sessions
       (id,user_id,name,shopping_date,status,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?)""",
    ("session-confirm", "u1", "Confirmation QA", "2026-11-22", "open",
     "2026-11-22T14:00:00Z", "2026-11-22T14:00:00Z"),
)

source = (ROOT / "src/lib/shopping-engine.server.js").read_text(encoding="utf-8")
start = source.index('if(subpath==="confirm" && method==="POST"){')
end = source.index('if (subpath === "audit" && method === "GET")', start)
handler = source[start:end]
assert "INSERT INTO shopping_expense_confirmations" in handler
assert "AND EXISTS (SELECT 1 FROM shopping_expense_confirmations WHERE id=?" in handler
assert "INSERT INTO shopping_audit_events" in handler
assert "INSERT INTO shopping_idempotency_keys" in handler
assert "WHERE EXISTS (" in handler[handler.index("INSERT INTO shopping_audit_events"):]
assert "WHERE EXISTS (" in handler[handler.index("INSERT INTO shopping_idempotency_keys"):]

def confirm_attempt(confirmation_id, idem_key):
    user_id = "u1"
    session_id = "session-confirm"
    operation = "session_confirm:" + session_id
    request_hash = "qa-hash-" + idem_key
    timestamp = "2026-11-22T14:01:00Z"
    response_json = json.dumps({
        "id": confirmation_id,
        "revision_number": 1,
        "calculated_total_paise": 0,
        "confirmed_total_paise": 0,
        "pending_bill_amounts": 0,
        "pending_items": [],
        "confirmed_at": timestamp,
    })

    insert = db.execute(
        """INSERT INTO shopping_expense_confirmations
           (id,user_id,session_id,revision_number,calculated_total_paise,
            confirmed_total_paise,estimate_id,calculation_snapshot_json,confirmed_at)
           SELECT ?,?,?,?,?,?,?,?,?
           WHERE EXISTS (
             SELECT 1 FROM shopping_sessions
             WHERE id=? AND user_id=? AND status IN ('open','ready_to_confirm')
           )""",
        (confirmation_id,user_id,session_id,1,0,0,None,"{}",timestamp,
         session_id,user_id),
    )
    inserted = insert.rowcount

    db.execute(
        """UPDATE shopping_sessions
           SET status='completed',confirmed_actual_total_paise=?,updated_at=?
           WHERE id=? AND user_id=? AND status IN ('open','ready_to_confirm')
             AND EXISTS (
               SELECT 1 FROM shopping_expense_confirmations
               WHERE id=? AND user_id=? AND session_id=?
             )""",
        (0,timestamp,session_id,user_id,confirmation_id,user_id,session_id),
    )

    db.execute(
        """INSERT INTO shopping_audit_events
           (id,user_id,session_id,entity_type,entity_id,event_type,
            before_json,after_json,created_at)
           SELECT ?,?,?,?,?,?,?,?,?
           WHERE EXISTS (
             SELECT 1 FROM shopping_expense_confirmations
             WHERE id=? AND user_id=? AND session_id=?
           )""",
        ("audit-"+confirmation_id,user_id,session_id,"session",session_id,
         "expense_confirmed",None,json.dumps({"confirmation_id":confirmation_id}),
         timestamp,confirmation_id,user_id,session_id),
    )

    db.execute(
        """INSERT INTO shopping_idempotency_keys
           (id,user_id,session_id,operation,idempotency_key,request_hash,
            response_json,response_status,created_at)
           SELECT ?,?,?,?,?,?,?,201,?
           WHERE EXISTS (
             SELECT 1 FROM shopping_expense_confirmations
             WHERE id=? AND user_id=? AND session_id=?
           )""",
        ("idem-"+confirmation_id,user_id,session_id,operation,idem_key,
         request_hash,response_json,timestamp,confirmation_id,user_id,session_id),
    )
    return inserted

# The first request confirms the session and writes exactly one confirmation,
# audit event and idempotency response.
assert confirm_attempt("confirmation-1", "qa-key-1") == 1
assert db.execute(
    "SELECT status FROM shopping_sessions WHERE id='session-confirm'"
).fetchone()[0] == "completed"
assert db.execute(
    "SELECT COUNT(*) FROM shopping_expense_confirmations WHERE session_id='session-confirm'"
).fetchone()[0] == 1
assert db.execute(
    "SELECT COUNT(*) FROM shopping_audit_events WHERE session_id='session-confirm' AND event_type='expense_confirmed'"
).fetchone()[0] == 1
assert db.execute(
    "SELECT COUNT(*) FROM shopping_idempotency_keys WHERE session_id='session-confirm' AND operation='session_confirm:session-confirm'"
).fetchone()[0] == 1

# A concurrent/late attempt with a different key must not create a second
# confirmation, false audit event, or poisoned idempotency response.
assert confirm_attempt("confirmation-2", "qa-key-2") == 0
assert db.execute(
    "SELECT COUNT(*) FROM shopping_expense_confirmations WHERE session_id='session-confirm'"
).fetchone()[0] == 1
assert db.execute(
    "SELECT COUNT(*) FROM shopping_audit_events WHERE session_id='session-confirm' AND event_type='expense_confirmed'"
).fetchone()[0] == 1
assert db.execute(
    "SELECT COUNT(*) FROM shopping_idempotency_keys WHERE session_id='session-confirm' AND operation='session_confirm:session-confirm'"
).fetchone()[0] == 1
assert db.execute(
    "SELECT COUNT(*) FROM shopping_idempotency_keys WHERE id='idem-confirmation-2'"
).fetchone()[0] == 0

violations = db.execute("PRAGMA foreign_key_check").fetchall()
assert not violations, f"Foreign key violations: {violations}"
print("Confirmation regression checks passed: one finalization, no duplicate snapshot/audit event, no poisoned idempotency key on retry.")
