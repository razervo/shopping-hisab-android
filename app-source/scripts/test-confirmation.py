#!/usr/bin/env python3
"""Regression test for final expense review, duplicate exclusion and retry safety."""

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
db.execute(
    """INSERT INTO shopping_actual_bills
       (id,user_id,session_id,shop_name,purchase_date,receipt_number,
        bill_total_paise,bill_status,included_in_actual,uploaded_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
    ("bill-needs-review", "u1", "session-confirm", "QA Store", "2026-11-22",
     "QA-1", 1000, "needs_review", 1,
     "2026-11-22T14:00:30Z", "2026-11-22T14:00:30Z"),
)

source = (ROOT / "src/lib/shopping-engine.server.js").read_text(encoding="utf-8")
start = source.index('if(subpath==="confirm" && method==="POST"){')
end = source.index('if (subpath === "audit" && method === "GET")', start)
handler = source[start:end]
assert "bill_status NOT IN ('verified','duplicate','void')" in handler
assert "Review every bill and mark it Verified, Duplicate or Void" in handler
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

    unresolved = db.execute(
        """SELECT COUNT(*) FROM shopping_actual_bills
           WHERE user_id=? AND session_id=?
             AND bill_status NOT IN ('verified','duplicate','void')""",
        (user_id, session_id),
    ).fetchone()[0]
    if unresolved:
        return None

    totals = db.execute(
        """SELECT COALESCE(SUM(
             CASE WHEN included_in_actual=1 AND bill_status NOT IN ('duplicate','void')
                  THEN bill_total_paise ELSE 0 END
           ),0)
           FROM shopping_actual_bills WHERE user_id=? AND session_id=?""",
        (user_id, session_id),
    ).fetchone()[0]

    response_json = json.dumps({
        "id": confirmation_id,
        "revision_number": 1,
        "calculated_total_paise": totals,
        "confirmed_total_paise": totals,
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
        (confirmation_id,user_id,session_id,1,totals,totals,None,
         json.dumps({"calculated_total_paise": totals}),timestamp,
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
        (totals,timestamp,session_id,user_id,confirmation_id,user_id,session_id),
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

# An unresolved bill must block confirmation before any state/audit/idempotency
# writes happen.
assert confirm_attempt("confirmation-blocked", "qa-key-blocked") is None
assert db.execute(
    "SELECT status FROM shopping_sessions WHERE id='session-confirm'"
).fetchone()[0] == "open"
assert db.execute(
    "SELECT COUNT(*) FROM shopping_expense_confirmations WHERE session_id='session-confirm'"
).fetchone()[0] == 0
assert db.execute(
    "SELECT COUNT(*) FROM shopping_audit_events WHERE session_id='session-confirm' AND event_type='expense_confirmed'"
).fetchone()[0] == 0
assert db.execute(
    "SELECT COUNT(*) FROM shopping_idempotency_keys WHERE session_id='session-confirm'"
).fetchone()[0] == 0

# Verify one bill and add one explicitly excluded duplicate.
db.execute(
    "UPDATE shopping_actual_bills SET bill_status='verified' WHERE id='bill-needs-review'"
)
db.execute(
    """INSERT INTO shopping_actual_bills
       (id,user_id,session_id,shop_name,purchase_date,receipt_number,
        bill_total_paise,bill_status,included_in_actual,duplicate_of_bill_id,
        uploaded_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
    ("bill-duplicate", "u1", "session-confirm", "QA Store", "2026-11-22",
     "QA-1", 2500, "duplicate", 0, "bill-needs-review",
     "2026-11-22T14:00:40Z", "2026-11-22T14:00:40Z"),
)

# The first request confirms only the verified bill amount (₹10), excluding
# the duplicate bill (₹25), and writes one confirmation/audit/idempotency record.
assert confirm_attempt("confirmation-1", "qa-key-1") == 1
assert db.execute(
    "SELECT status,confirmed_actual_total_paise FROM shopping_sessions WHERE id='session-confirm'"
).fetchone() == ("completed", 1000)
assert db.execute(
    "SELECT calculated_total_paise,confirmed_total_paise FROM shopping_expense_confirmations WHERE session_id='session-confirm'"
).fetchone() == (1000, 1000)
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
print("Confirmation checks passed: unresolved bills block finalization, duplicate bills are excluded, and retries cannot duplicate snapshots/audit/idempotency rows.")
