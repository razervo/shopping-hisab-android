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

source = (ROOT / "src/lib/native-api.server.js").read_text(encoding="utf-8")
start_marker = "const sql = `"
start = source.index(start_marker) + len("const sql = `")
end = source.index("`;", start)
query = source[start:end]
assert "${legacyDateFilter}" in query
assert "${sessionDateFilter}" in query


def run_report(from_date=None, to_date=None, limit=200, offset=0):
    sql = query
    values = ["u1"]
    if from_date and to_date:
        sql = sql.replace("${legacyDateFilter}", " AND date >= ? AND date <= ?")
        values.extend([from_date, to_date])
    else:
        sql = sql.replace("${legacyDateFilter}", "")
    values.append("u1")
    if from_date and to_date:
        sql = sql.replace("${sessionDateFilter}", " AND s.shopping_date >= ? AND s.shopping_date <= ?")
        values.extend([from_date, to_date])
    else:
        sql = sql.replace("${sessionDateFilter}", "")
    values.extend([limit + 1, offset])
    rows = db.execute(sql, values).fetchall()
    columns = [column[0] for column in db.execute(sql, values).description]
    records = [dict(zip(columns, row)) for row in rows[:limit]]
    return records, len(rows) > limit, (str(offset + limit) if len(rows) > limit else None)


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

violations = db.execute("PRAGMA foreign_key_check").fetchall()
assert not violations, f"Foreign key violations: {violations}"
print("Reporting regression checks passed: combined totals, legacy de-duplication, duplicate bills, item/receipt details and pagination.")
