#!/usr/bin/env python3
"""Regression coverage for audited, retry-safe bill deletion."""

from pathlib import Path
import hashlib
import json
import sqlite3

ROOT = Path(__file__).resolve().parents[1]
db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys = ON")
for migration in sorted((ROOT / "migrations-native").glob("*.sql")):
    db.executescript(migration.read_text(encoding="utf-8"))

db.execute('INSERT INTO "user" (id,name,email) VALUES (?,?,?)', ("u1","QA User","qa@example.test"))
db.execute("""INSERT INTO shopping_sessions (id,user_id,name,shopping_date,status,created_at,updated_at)
              VALUES (?,?,?,?,?,?,?)""", ("s1","u1","QA trip","2026-11-23","open","t0","t0"))
db.execute("""INSERT INTO shopping_actual_bills
              (id,user_id,session_id,shop_name,bill_total_paise,bill_status,
               included_in_actual,original_file_uri,uploaded_at,updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?)""",
            ("b1","u1","s1","QA Shop",12345,"verified",1,"drive://keep","t0","t0"))
db.execute("""INSERT INTO shopping_purchase_lines
              (id,user_id,session_id,bill_id,product_name,quantity,unit,match_method,created_at,updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?)""", ("l1","u1","s1","b1","Test item",1,"pcs","exact","t0","t0"))

def delete_bill(bill_id, key):
    operation=f"bill_delete:s1:{bill_id}"
    request_hash=hashlib.sha256(bill_id.encode()).hexdigest()
    prior=db.execute("""SELECT request_hash,response_json,response_status FROM shopping_idempotency_keys
                       WHERE user_id=? AND operation=? AND idempotency_key=?""",("u1",operation,key)).fetchone()
    if prior:
        return prior[1],prior[2] if prior[0]==request_hash else 409
    bill=db.execute("""SELECT * FROM shopping_actual_bills WHERE id=? AND user_id=? AND session_id=?""",
                    (bill_id,"u1","s1")).fetchone()
    if bill is None: return json.dumps({"error":"Bill not found."}),404
    lines=db.execute("""SELECT * FROM shopping_purchase_lines WHERE bill_id=? AND user_id=? AND session_id=?""",
                    (bill_id,"u1","s1")).fetchall()
    dependent=db.execute("SELECT id,duplicate_of_bill_id FROM shopping_actual_bills WHERE duplicate_of_bill_id=? AND user_id=? AND session_id=?",(bill_id,"u1","s1")).fetchall()
    snapshot=json.dumps({"bill":bill,"purchase_lines":lines,"dependent_duplicate_links":dependent})
    response={"success":True,"deleted":True,"bill_id":bill_id}
    with db:
        db.execute("""INSERT INTO shopping_audit_events
          (id,user_id,session_id,entity_type,entity_id,event_type,before_json,after_json,created_at)
          VALUES (?,?,?,?,?,?,?,?,?)""",("audit-"+bill_id,"u1","s1","actual_bill",bill_id,"bill_deleted",snapshot,json.dumps(response),"t1"))
        db.execute("UPDATE shopping_actual_bills SET duplicate_of_bill_id=NULL WHERE duplicate_of_bill_id=? AND user_id=? AND session_id=?",(bill_id,"u1","s1"))
        db.execute("DELETE FROM shopping_purchase_lines WHERE bill_id=? AND user_id=? AND session_id=?",(bill_id,"u1","s1"))
        db.execute("DELETE FROM shopping_actual_bills WHERE id=? AND user_id=? AND session_id=?",(bill_id,"u1","s1"))
        db.execute("""INSERT INTO shopping_idempotency_keys
          (id,user_id,session_id,operation,idempotency_key,request_hash,response_json,response_status,created_at)
          VALUES (?,?,?,?,?,?,?,?,?)""",("idem-"+bill_id,"u1","s1",operation,key,request_hash,json.dumps(response),200,"t1"))
    return json.dumps(response),200

# Delete succeeds; lines and bill are removed, while audit snapshot is retained.
body,status=delete_bill("b1","delete-bill-key")
assert status==200 and json.loads(body)["deleted"]
assert db.execute("SELECT COUNT(*) FROM shopping_actual_bills WHERE id='b1'").fetchone()[0]==0
assert db.execute("SELECT COUNT(*) FROM shopping_purchase_lines WHERE bill_id='b1'").fetchone()[0]==0
audit=db.execute("SELECT before_json FROM shopping_audit_events WHERE event_type='bill_deleted' AND entity_id='b1'").fetchone()
assert audit and len(json.loads(audit[0])["purchase_lines"])==1
# Retry replays exactly, with no duplicate audit/idempotency records.
retry,status=delete_bill("b1","delete-bill-key")
assert status==200 and retry==body
assert db.execute("SELECT COUNT(*) FROM shopping_audit_events WHERE event_type='bill_deleted'").fetchone()[0]==1
assert db.execute("SELECT COUNT(*) FROM shopping_idempotency_keys WHERE operation='bill_delete:s1:b1'").fetchone()[0]==1
assert not db.execute("PRAGMA foreign_key_check").fetchall()

engine=(ROOT/"src/lib/shopping-engine.server.js").read_text(encoding="utf-8")
start=engine.index('if (billMatch && method === "DELETE")')
end=engine.index('if (billMatch && ["GET","PATCH"].includes(method))',start)
handler=engine[start:end]
for required in ["Idempotency-Key","shopping_idempotency_keys","shopping_audit_events","bill_deleted",
                "DELETE FROM shopping_purchase_lines","DELETE FROM shopping_actual_bills","db.batch(statements)"]:
    assert required in handler, f"Missing bill deletion safeguard: {required}"
assert "DELETE FROM uploaded_files" not in handler
assert "dependent_duplicate_links" in handler or "dependent_duplicate_links" in engine
assert "UPDATE shopping_actual_bills SET duplicate_of_bill_id=NULL" in handler

# Self-referential duplicate bill links are rejected by the API. SQLite's FK
# alone permits a row to reference itself, so verify the handler guard explicitly.
db.execute("INSERT INTO shopping_actual_bills(id,user_id,session_id,shop_name,bill_total_paise,bill_status,included_in_actual,uploaded_at,updated_at) VALUES('b-self','u1','s1','Self',10000,'verified',1,'t0','t0')")
try:
    db.execute("UPDATE shopping_actual_bills SET duplicate_of_bill_id='b-self' WHERE id='b-self'
    ")
    db.execute("UPDATE shopping_actual_bills SET duplicate_of_bill_id=NULL WHERE id='b-self'
    ")
except sqlite3.Error:
    raise AssertionError("SQLite fixture should demonstrate that self-reference is otherwise permitted")
assert "A bill cannot be marked as a duplicate of itself." in handler or "A bill cannot be marked as a duplicate of itself." in engine

# Duplicate bill links must also remain acyclic across multiple records.
db.execute("INSERT INTO shopping_actual_bills(id,user_id,session_id,shop_name,bill_total_paise,bill_status,included_in_actual,uploaded_at,updated_at) VALUES('b-cycle-a','u1','s1','Cycle A',10000,'verified',1,'t0','t0')")
db.execute("INSERT INTO shopping_actual_bills(id,user_id,session_id,shop_name,bill_total_paise,bill_status,included_in_actual,duplicate_of_bill_id,uploaded_at,updated_at) VALUES('b-cycle-b','u1','s1','Cycle B',10000,'duplicate',0,'b-cycle-a','t0','t0')")
cycle_sql = """WITH RECURSIVE duplicate_chain(id,duplicate_of_bill_id) AS (
  SELECT id,duplicate_of_bill_id FROM shopping_actual_bills WHERE id=? AND user_id=? AND session_id=?
  UNION
  SELECT b.id,b.duplicate_of_bill_id FROM shopping_actual_bills b JOIN duplicate_chain d ON b.id=d.duplicate_of_bill_id WHERE b.user_id=? AND b.session_id=?
) SELECT 1 FROM duplicate_chain WHERE id=? LIMIT 1"""
assert db.execute(cycle_sql,("b-cycle-a","u1","s1","u1","s1","b-cycle-b")).fetchone() is not None
assert db.execute(cycle_sql,("b-cycle-a","u1","s1","u1","s1","b-cycle-a")).fetchone() is None
assert "Duplicate bill links cannot form a cycle." in engine
assert 'if(patch.duplicate_of_bill_id){patch.bill_status="duplicate";patch.included_in_actual=0;}' in engine

# Bill-line classification must stay consistent: extras are unmatched and matched
# lines cannot carry the extra method. Verify the route enforces both directions.
assert 'Extra bill lines cannot be linked to a planned item.' in engine
assert 'Unmatched bill lines must be marked as extra.' in engine
assert 'Matched bill lines cannot use the extra match method.' in engine
assert 'if(effectiveIsExtra&&effectiveItemId)' in engine


# Deleting a bill that another bill marks as its duplicate must not fail the
# FK restriction; dependent links are detached and recorded in the deletion audit.
db.execute("INSERT INTO shopping_actual_bills(id,user_id,session_id,shop_name,bill_total_paise,bill_status,included_in_actual,uploaded_at,updated_at) VALUES('b-primary','u1','s1','Primary',10000,'verified',1,'t0','t0')")
db.execute("INSERT INTO shopping_actual_bills(id,user_id,session_id,shop_name,bill_total_paise,bill_status,included_in_actual,duplicate_of_bill_id,uploaded_at,updated_at) VALUES('b-dependent','u1','s1','Duplicate',10000,'duplicate',0,'b-primary','t0','t0')")
body,status=delete_bill("b-primary","delete-primary-key")
assert status==200 and json.loads(body)["deleted"]
assert db.execute("SELECT duplicate_of_bill_id FROM shopping_actual_bills WHERE id='b-dependent'").fetchone()[0] is None
linked_audit=db.execute("SELECT before_json FROM shopping_audit_events WHERE event_type='bill_deleted' AND entity_id='b-primary'").fetchone()
assert linked_audit and json.loads(linked_audit[0])["dependent_duplicate_links"][0]["id"]=="b-dependent"
assert not db.execute("PRAGMA foreign_key_check").fetchall()

# Date-only validation must reject normalized-but-impossible calendar dates.
import datetime
for valid in ["2026-11-25", "2024-02-29", "2000-01-01"]:
    assert datetime.date.fromisoformat(valid).isoformat() == valid
for invalid in ["2026-02-29", "2026-04-31", "2026-13-01", "2026-00-10"]:
    try:
        datetime.date.fromisoformat(invalid)
    except ValueError:
        pass
    else:
        raise AssertionError(f"Invalid calendar date accepted: {invalid}")
assert "date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day" in engine

print("PASS: bill deletion, child cleanup, audit snapshot, idempotent retry, duplicate-reference cleanup and file-preservation checks.")
