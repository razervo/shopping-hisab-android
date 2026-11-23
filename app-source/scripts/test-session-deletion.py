#!/usr/bin/env python3
"""Regression coverage for confirmed deletion of populated and completed trips."""
from pathlib import Path
import json
import sqlite3

ROOT = Path(__file__).resolve().parents[1]
db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys=ON")
for migration in sorted((ROOT / "migrations-native").glob("*.sql")):
    db.executescript(migration.read_text(encoding="utf-8"))
db.execute('INSERT INTO "user"(id,name,email) VALUES("u1","QA","qa@example.test")')
db.execute('INSERT INTO uploaded_files(id,user_id,r2_key,original_name,content_type,size_bytes) VALUES("file1","u1","r2/file1","receipt.jpg","image/jpeg",100)')

def seed_trip(sid, status="open"):
    db.execute("""INSERT INTO shopping_sessions(id,user_id,name,shopping_date,status)
                  VALUES(?,?,?,?,?)""", (sid,"u1","Trip", "2026-11-23",status))
    db.execute("""INSERT INTO shopping_source_lists(id,user_id,session_id,source_type,file_id,ocr_status)
                  VALUES(?,?,?,?,?,?)""",("list-"+sid,"u1",sid,"handwritten_scan","file1","completed"))
    db.execute("""INSERT INTO shopping_source_lines(id,user_id,session_id,source_list_id,original_name,recognized_name)
                  VALUES(?,?,?,?,?,?)""",("src-"+sid,"u1",sid,"list-"+sid,"Rice","Rice"))
    db.execute("""INSERT INTO shopping_items(id,user_id,session_id,product_name,planned_quantity)
                  VALUES(?,?,?,?,?)""",("item-"+sid,"u1",sid,"Rice",1))
    db.execute("""INSERT INTO shopping_item_sources(id,user_id,session_id,shopping_item_id,source_line_id)
                  VALUES(?,?,?,?,?)""",("map-"+sid,"u1",sid,"item-"+sid,"src-"+sid))
    db.execute("""INSERT INTO shopping_estimates(id,user_id,session_id,version_number,estimated_total_paise)
                  VALUES(?,?,?,?,?)""",("est-"+sid,"u1",sid,1,5000))
    db.execute("""INSERT INTO shopping_estimate_lines(id,user_id,session_id,estimate_id,shopping_item_id,quantity,estimated_unit_price_paise,estimated_line_total_paise,price_source)
                  VALUES(?,?,?,?,?,?,?,?,?)""",("el-"+sid,"u1",sid,"est-"+sid,"item-"+sid,1,5000,5000,"manual"))
    db.execute("""INSERT INTO shopping_actual_bills(id,user_id,session_id,file_id,bill_total_paise,bill_status,duplicate_of_bill_id)
                  VALUES(?,?,?,?,?,?,?)""",("bill-"+sid,"u1",sid,"file1",5000,"verified",None))
    db.execute("""INSERT INTO shopping_purchase_lines(id,user_id,session_id,bill_id,shopping_item_id,product_name,quantity,unit_price_paise,line_amount_paise)
                  VALUES(?,?,?,?,?,?,?,?,?)""",("pl-"+sid,"u1",sid,"bill-"+sid,"item-"+sid,"Rice",1,5000,5000))
    db.execute("""INSERT INTO shopping_expense_confirmations(id,user_id,session_id,revision_number,calculated_total_paise,confirmed_total_paise,calculation_snapshot_json)
                  VALUES(?,?,?,?,?,?,?)""",("conf-"+sid,"u1",sid,1,5000,5000,"{}"))
    db.execute("""INSERT INTO shopping_audit_events(id,user_id,session_id,entity_type,entity_id,event_type,created_at)
                  VALUES(?,?,?,?,?,?,?)""",("audit-"+sid,"u1",sid,"session",sid,"trip_created","2026-11-23T10:00:00Z"))
    db.execute("""INSERT INTO shopping_idempotency_keys(id,user_id,session_id,operation,idempotency_key,request_hash,response_json,response_status)
                  VALUES(?,?,?,?,?,?,?,?,?)""",("key-"+sid,"u1",sid,"op","idem-"+sid,"hash","{}",200))

def delete_trip(sid, key):
    current=db.execute("SELECT * FROM shopping_sessions WHERE id=? AND user_id='u1'",(sid,)).fetchone()
    if not current: return False
    tables=["shopping_source_lists","shopping_source_lines","shopping_items","shopping_item_sources","shopping_estimates","shopping_estimate_lines","shopping_actual_bills","shopping_purchase_lines","shopping_expense_confirmations","shopping_audit_events","shopping_idempotency_keys"]
    snap={}
    for table in tables:
        snap[table]=[dict(zip([d[0] for d in db.execute(f"SELECT * FROM {table} WHERE user_id='u1' AND session_id=?",(sid,)).description],row)) for row in db.execute(f"SELECT * FROM {table} WHERE user_id='u1' AND session_id=?",(sid,)).fetchall()]
    snapshot=json.dumps({"session":{"id":current[0],"status":current[4]}, "tables":snap})
    db.execute("INSERT INTO shopping_session_deletion_log(id,user_id,deleted_session_id,idempotency_key,session_snapshot_json) VALUES(?,?,?,?,?)",("log-"+sid,"u1",sid,key,snapshot))
    cleanup=[
        "shopping_expense_confirmations","shopping_estimate_lines","shopping_estimates",
        "shopping_item_sources","shopping_purchase_lines",
    ]
    for t in cleanup: db.execute(f"DELETE FROM {t} WHERE user_id='u1' AND session_id=?",(sid,))
    db.execute("UPDATE shopping_actual_bills SET duplicate_of_bill_id=NULL WHERE user_id='u1' AND session_id=?",(sid,))
    for t in ["shopping_actual_bills","shopping_source_lines","shopping_source_lists","shopping_items","shopping_audit_events","shopping_idempotency_keys"]:
        db.execute(f"DELETE FROM {t} WHERE user_id='u1' AND session_id=?",(sid,))
    db.execute("DELETE FROM shopping_sessions WHERE id=? AND user_id='u1'",(sid,))
    return True

# Nonempty trip deletion succeeds, snapshot includes data, attachment metadata/file retained.
seed_trip("data-trip")
assert delete_trip("data-trip","del-1")
assert db.execute("SELECT COUNT(*) FROM shopping_sessions WHERE id='data-trip'").fetchone()[0]==0
snap=json.loads(db.execute("SELECT session_snapshot_json FROM shopping_session_deletion_log WHERE deleted_session_id='data-trip'").fetchone()[0])
assert len(snap["tables"]["shopping_actual_bills"])==1 and len(snap["tables"]["shopping_purchase_lines"])==1
assert db.execute("SELECT COUNT(*) FROM uploaded_files WHERE id='file1'").fetchone()[0]==1
assert db.execute("PRAGMA foreign_key_check").fetchall()==[]

# Completed trips can be deleted through the explicit delete operation.
seed_trip("completed-trip","completed")
assert delete_trip("completed-trip","del-2")
assert db.execute("SELECT COUNT(*) FROM shopping_session_deletion_log WHERE deleted_session_id='completed-trip'").fetchone()[0]==1
assert db.execute("PRAGMA foreign_key_check").fetchall()==[]

# Duplicate-bill FK links are cleared safely before bill deletion.
seed_trip("duplicate-trip")
db.execute("INSERT INTO shopping_actual_bills(id,user_id,session_id,bill_total_paise,bill_status,duplicate_of_bill_id) VALUES('bill-duplicate','u1','duplicate-trip',5000,'duplicate','bill-duplicate-trip')")
assert delete_trip("duplicate-trip","del-3")
assert db.execute("PRAGMA foreign_key_check").fetchall()==[]

# Static assertions ensure the production handler follows the covered cleanup/snapshot strategy.
engine=(ROOT/"src/lib/shopping-engine.server.js").read_text(encoding="utf-8")
handler=engine[engine.index('if (!subpath && method === "DELETE")'):engine.index("\n  const session = await ownedSession(db,userId,sessionId);",engine.index('if (!subpath && method === "DELETE")'))]
assert "const snapshots = {}" in handler and "tables: snapshots" in handler
assert "shopping_session_deletion_log" in handler and "shopping_expense_confirmations" in handler
assert 'UPDATE shopping_actual_bills SET duplicate_of_bill_id=NULL' in handler
assert "Finished trips are protected and cannot be deleted." not in handler
assert "Attachment metadata and physical files are intentionally not deleted" in handler
route=(ROOT/"src/routes/_authed/sessions/$sessionId.jsx").read_text(encoding="utf-8")
assert "Delete trip" in route and "Delete empty trip" not in route
assert "deleteTrip" in route and "ALL saved trip data" in route
print("PASS: populated/completed trip deletion, full snapshots, FK-safe cleanup, duplicate references, and attachment retention.")
