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
    snapshot=json.dumps({"bill":bill,"purchase_lines":lines})
    response={"success":True,"deleted":True,"bill_id":bill_id}
    with db:
        db.execute("""INSERT INTO shopping_audit_events
          (id,user_id,session_id,entity_type,entity_id,event_type,before_json,after_json,created_at)
          VALUES (?,?,?,?,?,?,?,?,?)""",("audit-b1","u1","s1","actual_bill","b1","bill_deleted",snapshot,json.dumps(response),"t1"))
        db.execute("DELETE FROM shopping_purchase_lines WHERE bill_id=? AND user_id=? AND session_id=?",(bill_id,"u1","s1"))
        db.execute("DELETE FROM shopping_actual_bills WHERE id=? AND user_id=? AND session_id=?",(bill_id,"u1","s1"))
        db.execute("""INSERT INTO shopping_idempotency_keys
          (id,user_id,session_id,operation,idempotency_key,request_hash,response_json,response_status,created_at)
          VALUES (?,?,?,?,?,?,?,?,?)""",("idem-b1","u1","s1",operation,key,request_hash,json.dumps(response),200,"t1"))
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

# Bill-line deletion is audited, recalculates reconciliation, and replays safely.
db.execute("""INSERT INTO shopping_actual_bills
              (id,user_id,session_id,shop_name,bill_total_paise,bill_status,
               included_in_actual,line_total_paise,reconciliation_difference_paise,uploaded_at,updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            ("b2","u1","s1","QA Shop 2",3000,"verified",1,3000,0,"t0","t0"))
db.executemany("""INSERT INTO shopping_purchase_lines
              (id,user_id,session_id,bill_id,product_name,quantity,unit_price_paise,line_amount_paise,created_at,updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?)""",
            [("l2","u1","s1","b2","Item A",1,1000,1000,"t0","t0"),
             ("l3","u1","s1","b2","Item B",2,1000,2000,"t0","t0")])
def delete_bill_line(line_id, key):
    operation=f"bill_line_delete:s1:{line_id}"
    request_hash=hashlib.sha256(line_id.encode()).hexdigest()
    prior=db.execute("""SELECT request_hash,response_json,response_status FROM shopping_idempotency_keys
                       WHERE user_id=? AND operation=? AND idempotency_key=?""",("u1",operation,key)).fetchone()
    if prior:
        assert prior[0]==request_hash
        return prior[1],prior[2]
    line=db.execute("SELECT * FROM shopping_purchase_lines WHERE id=? AND user_id=? AND session_id=?",(line_id,"u1","s1")).fetchone()
    if line is None: return json.dumps({"error":"Bill line not found."}),404
    bill_id=line[3]
    response={"success":True,"bill_id":bill_id,"line_id":line_id}
    with db:
        db.execute("DELETE FROM shopping_purchase_lines WHERE id=? AND user_id=? AND session_id=?",(line_id,"u1","s1"))
        db.execute("""UPDATE shopping_actual_bills SET
          line_total_paise=CASE WHEN
            (SELECT COUNT(*) FROM shopping_purchase_lines WHERE bill_id=? AND user_id=? AND session_id=?)
            =(SELECT COUNT(line_amount_paise) FROM shopping_purchase_lines WHERE bill_id=? AND user_id=? AND session_id=?)
            THEN COALESCE((SELECT SUM(line_amount_paise) FROM shopping_purchase_lines WHERE bill_id=? AND user_id=? AND session_id=?),0)
            ELSE NULL END,
          reconciliation_difference_paise=CASE WHEN bill_total_paise IS NULL OR
            (SELECT COUNT(*) FROM shopping_purchase_lines WHERE bill_id=? AND user_id=? AND session_id=?)
            <>(SELECT COUNT(line_amount_paise) FROM shopping_purchase_lines WHERE bill_id=? AND user_id=? AND session_id=?)
            THEN NULL ELSE bill_total_paise-(SELECT COALESCE(SUM(line_amount_paise),0) FROM shopping_purchase_lines WHERE bill_id=? AND user_id=? AND session_id=?)
          END WHERE id=? AND user_id=? AND session_id=?""",
          (bill_id,"u1","s1",bill_id,"u1","s1",bill_id,"u1","s1",bill_id,"u1","s1",bill_id,"u1","s1",bill_id,"u1","s1",bill_id,"u1","s1"))
        db.execute("""INSERT INTO shopping_audit_events
          (id,user_id,session_id,entity_type,entity_id,event_type,before_json,after_json,created_at)
          VALUES (?,?,?,?,?,?,?,?,?)""",("audit-l2","u1","s1","purchase_line",line_id,"bill_line_deleted",json.dumps(line),json.dumps(response),"t1"))
        db.execute("""INSERT INTO shopping_idempotency_keys
          (id,user_id,session_id,operation,idempotency_key,request_hash,response_json,response_status,created_at)
          VALUES (?,?,?,?,?,?,?,?,?)""",("idem-l2","u1","s1",operation,key,request_hash,json.dumps(response),200,"t1"))
    return json.dumps(response),200
body,status=delete_bill_line("l2","delete-line-key")
assert status==200 and json.loads(body)["line_id"]=="l2"
bill=db.execute("SELECT line_total_paise,reconciliation_difference_paise FROM shopping_actual_bills WHERE id='b2'").fetchone()
assert bill==(2000,1000), f"Line deletion reconciliation incorrect: {bill}"
retry,status=delete_bill_line("l2","delete-line-key")
assert status==200 and retry==body
assert db.execute("SELECT COUNT(*) FROM shopping_purchase_lines WHERE id='l2'").fetchone()[0]==0
assert db.execute("SELECT COUNT(*) FROM shopping_audit_events WHERE event_type='bill_line_deleted' AND entity_id='l2'").fetchone()[0]==1
assert db.execute("SELECT COUNT(*) FROM shopping_idempotency_keys WHERE operation='bill_line_delete:s1:l2'").fetchone()[0]==1
assert not db.execute("PRAGMA foreign_key_check").fetchall()

engine=(ROOT/"src/lib/shopping-engine.server.js").read_text(encoding="utf-8")
start=engine.index('if (billMatch && method === "DELETE")')
end=engine.index('if (billMatch && ["GET","PATCH"].includes(method))',start)
handler=engine[start:end]
for required in ["Idempotency-Key","shopping_idempotency_keys","shopping_audit_events","bill_deleted",
                "DELETE FROM shopping_purchase_lines","DELETE FROM shopping_actual_bills","db.batch(statements)"]:
    assert required in handler, f"Missing bill deletion safeguard: {required}"
assert "DELETE FROM uploaded_files" not in handler
line_delete_start=engine.index('if(purchaseLineMatch && method==="DELETE")')
line_delete_end=engine.index('if(subpath==="confirm" && method==="POST")',line_delete_start)
line_delete_handler=engine[line_delete_start:line_delete_end]
for required in ["Idempotency-Key","bill_line_delete:","shopping_idempotency_keys","bill_line_deleted","db.batch(statements)","line_total_paise=CASE"]:
    assert required in line_delete_handler, f"Missing bill-line deletion safeguard: {required}"
assert "routeBillId=purchaseLineMatch[1],lineId=purchaseLineMatch[2]" in line_delete_handler
assert "line.bill_id!==routeBillId" in line_delete_handler, "Bill-line delete must validate the bill path ownership"
assert "completedDeleteAllowed" in engine and "bills\\/" in engine, "Completed trips must allow only bill and bill-line deletes"
ui=(ROOT/"src/routes/_authed/sessions/$sessionId.jsx").read_text(encoding="utf-8")
assert 'headers: { "Idempotency-Key": requestKey }' in ui, "Bill-line delete must send a stable retry key"
assert "Delete bill" in ui and "deleteBillLine" in ui, "Completed-trip deletion actions remain available in UI"
print("PASS: bill and bill-line deletion, completed-trip allowance, reconciliation, audit, idempotent retry, and file-preservation checks.")
