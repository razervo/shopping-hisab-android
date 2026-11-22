#!/usr/bin/env python3
"""Regression tests for reports that combine legacy records and completed sessions."""

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
    'INSERT INTO "user" (id, name, email) VALUES (?, ?, ?)',
    ("u2", "Other QA User", "other-qa@example.test"),
)

# A legacy record is retained as the source of truth for its linked legacy session.
db.execute(
    """INSERT INTO shopping_records
       (id,user_id,shop_name,date,items_json,total,item_count,notes,source,
        receipts_json,reconciliation_status,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
    ("legacy-1", "u1", "Old Shop", "2026-11-10",
     '[{"name":"Oil","qty":1,"unit":"L","price":10,"amount":10}]',
     10.0, 1, "", "manual", "[]", "not_required",
     "2026-11-10T10:00:00Z", "2026-11-10T10:00:00Z"),
)
db.execute(
    """INSERT INTO shopping_sessions
       (id,user_id,name,shopping_date,status,confirmed_actual_total_paise,
        legacy_record_id,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)""",
    ("legacy-session", "u1", "Old Shop", "2026-11-10", "completed",
     1000, "legacy-1", "2026-11-10T10:00:00Z", "2026-11-10T10:00:00Z"),
)

# A new completed session includes one counted bill and one duplicate bill.
db.execute(
    """INSERT INTO shopping_sessions
       (id,user_id,name,shopping_date,status,confirmed_actual_total_paise,
        legacy_record_id,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)""",
    ("session-1", "u1", "Market run", "2026-11-22", "completed",
     1750, None, "2026-11-22T12:00:00Z", "2026-11-22T12:10:00Z"),
)
db.executemany(
    """INSERT INTO shopping_actual_bills
       (id,user_id,session_id,shop_name,purchase_date,receipt_number,
        bill_total_paise,bill_status,included_in_actual,uploaded_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
    [
        ("bill-1", "u1", "session-1", "QA Market", "2026-11-22", "R-1",
         1750, "verified", 1, "2026-11-22T12:02:00Z", "2026-11-22T12:02:00Z"),
        ("bill-dup", "u1", "session-1", "QA Market", "2026-11-22", "R-1",
         1750, "duplicate", 0, "2026-11-22T12:03:00Z", "2026-11-22T12:03:00Z"),
    ],
)
db.executemany(
    """INSERT INTO shopping_purchase_lines
       (id,user_id,session_id,bill_id,product_name,quantity,unit,
        unit_price_paise,line_amount_paise,is_extra,match_method,
        original_ocr_json,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
    [
        ("line-1", "u1", "session-1", "bill-1", "Rice", 1, "kg",
         1750, 1750, 0, "exact", "{}", "2026-11-22T12:02:00Z", "2026-11-22T12:02:00Z"),
        ("line-dup", "u1", "session-1", "bill-dup", "Rice", 1, "kg",
         1750, 1750, 0, "exact", "{}", "2026-11-22T12:03:00Z", "2026-11-22T12:03:00Z"),
    ],
)

server_source = (ROOT / "src/server.js").read_text(encoding="utf-8")
assert 'url.pathname === "/api/reports"' in server_source
assert 'url.pathname === "/api/reports/export"' in server_source
assert 'return handleNativeApi(request, env);' in server_source

source = (ROOT / "src/lib/native-api.server.js").read_text(encoding="utf-8")
assert 'url.pathname === "/api/reports" || url.pathname === "/api/reports/export"' in source
start_marker = "const sql = `"
start = source.index(start_marker) + len("const sql = `")
end = source.index("`;", start)
query = source[start:end]
assert "${legacyWhere}" in query
assert "${sessionWhere}" in query


def run_report(from_date=None, to_date=None, limit=200, offset=0, shop=None, record_id=None, user_id="u1"):
    sql = query
    legacy_filters = []
    legacy_values = []
    session_filters = []
    session_values = []
    if shop:
        legacy_filters.append("instr(lower(shop_name), lower(?)) > 0")
        legacy_values.append(shop)
        session_filters.append("instr(lower(COALESCE(NULLIF(s.name, ''), 'Shopping session')), lower(?)) > 0")
        session_values.append(shop)
    if from_date:
        legacy_filters.append("date >= ?")
        legacy_values.append(from_date)
        session_filters.append("s.shopping_date >= ?")
        session_values.append(from_date)
    if to_date:
        legacy_filters.append("date <= ?")
        legacy_values.append(to_date)
        session_filters.append("s.shopping_date <= ?")
        session_values.append(to_date)
    if record_id:
        legacy_filters.append("id = ?")
        legacy_values.append(record_id)
        session_filters.append("s.id = ?")
        session_values.append(record_id)
    sql = sql.replace("${legacyWhere}", "".join(f" AND {item}" for item in legacy_filters))
    sql = sql.replace("${sessionWhere}", "".join(f" AND {item}" for item in session_filters))
    values = [user_id, *legacy_values, user_id, *session_values, limit + 1, offset]
    rows = db.execute(sql, values).fetchall()
    columns = [column[0] for column in db.execute(sql, values).description]
    records = [dict(zip(columns, row)) for row in rows[:limit]]
    return records, len(rows) > limit, (str(offset + limit) if len(rows) > limit else None)


# A second account must not see the first account's completed session or legacy records.
other_history, _, _ = run_report(limit=30, offset=0, user_id="u2")
assert other_history == []
cross_account_detail, _, _ = run_report(record_id="session-1", limit=1, user_id="u2")
assert cross_account_detail == [], "A second user must not retrieve another account's session by ID"


monthly, has_more, next_cursor = run_report("2026-11-01", "2026-11-30", 10, 0)
assert not has_more and next_cursor is None
assert len(monthly) == 2, f"Expected the legacy record and new session only, got {len(monthly)}"
assert {row["id"] for row in monthly} == {"legacy-1", "session-1"}
session = next(row for row in monthly if row["id"] == "session-1")
assert round(session["total"], 2) == 17.50
assert session["item_count"] == 1, "Duplicate bill lines must not enter item totals"
assert len(json.loads(session["items_json"])) == 1
receipts = json.loads(session["receipts_json"])
assert len(receipts) == 2, "Receipt export should preserve duplicate/void review metadata"
assert any(receipt["status"] == "duplicate" for receipt in receipts)

# Pagination must cover the entire combined record set once.
first, more, cursor = run_report(limit=1, offset=0)
second, more2, cursor2 = run_report(limit=1, offset=int(cursor or 0))
assert more and cursor == "1"
assert not more2 and cursor2 is None
assert {first[0]["id"], second[0]["id"]} == {"legacy-1", "session-1"}

# The same completed sessions must appear in the main History list, shop search and detail lookup.
history, _, _ = run_report(limit=30, offset=0)
assert {row["id"] for row in history} == {"legacy-1", "session-1"}
by_shop, _, _ = run_report(shop="Market")
assert len(by_shop) == 1 and by_shop[0]["id"] == "session-1"
detail, detail_more, _ = run_report(record_id="session-1", limit=1)
assert not detail_more and len(detail) == 1 and detail[0]["source"] == "session"


legacy = db.execute(
    "SELECT COALESCE(SUM(total),0),COALESCE(MAX(total),0),COUNT(*) FROM shopping_records WHERE user_id=?",
    ("u1",),
).fetchone()
sessions = db.execute(
    """SELECT COALESCE(SUM(COALESCE(confirmed_actual_total_paise,0)),0)/100.0,
              COALESCE(MAX(confirmed_actual_total_paise),0)/100.0,COUNT(*)
       FROM shopping_sessions
       WHERE user_id=? AND status='completed' AND legacy_record_id IS NULL""",
    ("u1",),
).fetchone()
assert round(legacy[0] + sessions[0], 2) == 27.50
assert round(max(legacy[1], sessions[1]), 2) == 17.50
assert legacy[2] + sessions[2] == 2

# Planned-item deletion must be owner/session scoped, auditable, and blocked when referenced.
engine_source = (ROOT / "src/lib/shopping-engine.server.js").read_text(encoding="utf-8")
delete_start = engine_source.index('if (itemMatch && method === "DELETE")')
delete_end = engine_source.index('if (itemMatch && method === "PATCH")', delete_start)
delete_handler = engine_source[delete_start:delete_end]
assert "user_id=? AND session_id=?" in delete_handler
assert "shopping_purchase_lines" in delete_handler
assert "shopping_estimate_lines" in delete_handler
assert "item_deleted" in delete_handler
assert "DELETE FROM shopping_items" in delete_handler

# An unused item can be deleted; source rows do not hold it in place.
db.execute(
    """INSERT INTO shopping_sessions
       (id,user_id,name,shopping_date,status,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?)""",
    ("delete-session", "u1", "Delete QA", "2026-11-22", "open",
     "2026-11-22T13:00:00Z", "2026-11-22T13:00:00Z"),
)
db.execute(
    """INSERT INTO shopping_items
       (id,user_id,session_id,product_name,normalized_name,planned_quantity,unit,item_status,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)""",
    ("unused-item", "u1", "delete-session", "Unused QA item", "unused qa item", 1, "kg", "planned",
     "2026-11-22T13:01:00Z", "2026-11-22T13:01:00Z"),
)
purchase_refs = db.execute(
    "SELECT COUNT(*) FROM shopping_purchase_lines WHERE shopping_item_id=? AND user_id=? AND session_id=?",
    ("unused-item", "u1", "delete-session"),
).fetchone()[0]
estimate_refs = db.execute(
    "SELECT COUNT(*) FROM shopping_estimate_lines WHERE shopping_item_id=? AND user_id=? AND session_id=?",
    ("unused-item", "u1", "delete-session"),
).fetchone()[0]
assert purchase_refs == 0 and estimate_refs == 0
db.execute(
    """INSERT INTO shopping_audit_events
       (id,user_id,session_id,entity_type,entity_id,event_type,before_json,after_json,created_at)
       SELECT ?,user_id,session_id,'shopping_item',id,'item_deleted','{}',NULL,?
       FROM shopping_items WHERE id=? AND user_id=? AND session_id=?""",
    ("delete-audit", "2026-11-22T13:02:00Z", "unused-item", "u1", "delete-session"),
)
db.execute(
    "DELETE FROM shopping_items WHERE id=? AND user_id=? AND session_id=?",
    ("unused-item", "u1", "delete-session"),
)
assert db.execute("SELECT COUNT(*) FROM shopping_items WHERE id='unused-item'").fetchone()[0] == 0
assert db.execute("SELECT COUNT(*) FROM shopping_audit_events WHERE entity_id='unused-item' AND event_type='item_deleted'").fetchone()[0] == 1

violations = db.execute("PRAGMA foreign_key_check").fetchall()
assert not violations, f"Foreign key violations: {violations}"
print("Regression checks passed: combined reports, legacy de-duplication, duplicate bills, item/receipt details, pagination and audited removal of unused planned items.")
