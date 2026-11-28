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
def delete_bill_line(bill_id, line_id, key):
    operation=f"bill_line_delete:s1:{bill_id}:{line_id}"
    request_hash=hashlib.sha256(json.dumps({"bill_id":bill_id,"line_id":line_id},separators=(",",":")).encode()).hexdigest()
    prior=db.execute("""SELECT request_hash,response_json,response_status FROM shopping_idempotency_keys
                       WHERE user_id=? AND operation=? AND idempotency_key=?""",("u1",operation,key)).fetchone()
    if prior:
        assert prior[0]==request_hash
        return prior[1],prior[2]
    line=db.execute("SELECT * FROM shopping_purchase_lines WHERE id=? AND user_id=? AND session_id=?",(line_id,"u1","s1")).fetchone()
    if line is None or line[3]!=bill_id: return json.dumps({"error":"Bill line not found."}),404
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
body,status=delete_bill_line("b2","l2","delete-line-key")
assert status==200 and json.loads(body)["line_id"]=="l2"
bill=db.execute("SELECT line_total_paise,reconciliation_difference_paise FROM shopping_actual_bills WHERE id='b2'").fetchone()
assert bill==(2000,1000), f"Line deletion reconciliation incorrect: {bill}"
retry,status=delete_bill_line("b2","l2","delete-line-key")
assert status==200 and retry==body
assert db.execute("SELECT COUNT(*) FROM shopping_purchase_lines WHERE id='l2'").fetchone()[0]==0
assert db.execute("SELECT COUNT(*) FROM shopping_audit_events WHERE event_type='bill_line_deleted' AND entity_id='l2'").fetchone()[0]==1
assert db.execute("SELECT COUNT(*) FROM shopping_idempotency_keys WHERE operation='bill_line_delete:s1:b2:l2'").fetchone()[0]==1
assert not db.execute("PRAGMA foreign_key_check").fetchall()


engine=(ROOT/"src/lib/shopping-engine.server.js").read_text(encoding="utf-8")
start=engine.index('if (billMatch && method === "DELETE")')
end=engine.index('if (billMatch && ["GET","PATCH"].includes(method))',start)
handler=engine[start:end]
for required in ["Idempotency-Key","shopping_idempotency_keys","shopping_audit_events","bill_deleted",
                "DELETE FROM shopping_purchase_lines","DELETE FROM shopping_actual_bills","db.batch(statements)"]:
    assert required in handler, f"Missing bill deletion safeguard: {required}"
# Concurrent deletion may lose the unique idempotency-key race after the winner's
# atomic batch commits. The loser must query that winner and replay the exact
# stored response rather than return an internal error.
assert "try{await db.batch(statements);}catch(cause)" in handler, "bill deletion must recover from a duplicate-key batch race"
assert "SELECT request_hash,response_json,response_status FROM shopping_idempotency_keys" in handler, "bill deletion must look up the race winner"
assert "return new Response(winner.response_json,{status:winner.response_status,headers})" in handler, "same-payload race must replay the winning response"
assert "throw cause;" in handler, "unrelated batch failures must not be swallowed"
assert "DELETE FROM uploaded_files" not in handler
assert "dependent_duplicate_links" in handler or "dependent_duplicate_links" in engine
assert "UPDATE shopping_actual_bills SET duplicate_of_bill_id=NULL" in handler

# Bill-line deletion has a separate route and must also recover a concurrent
# duplicate-key batch winner; the sequential model above cannot exercise that.
line_delete_start = engine.index('if(purchaseLineMatch && method==="DELETE"){')
line_delete_end = engine.index('if(subpath==="confirm" && method==="POST"){', line_delete_start)
line_delete_handler = engine[line_delete_start:line_delete_end]
assert "try{await db.batch(statements);}catch(cause)" in line_delete_handler
assert "SELECT request_hash,response_json,response_status FROM shopping_idempotency_keys" in line_delete_handler
assert "winner.request_hash===requestHash" in line_delete_handler
assert "winner.request_hash===requestHash?new Response(winner.response_json,{status:winner.response_status,headers})" in line_delete_handler

# Self-referential duplicate bill links are rejected by the API. SQLite's FK
# alone permits a row to reference itself, so verify the handler guard explicitly.
db.execute("INSERT INTO shopping_actual_bills(id,user_id,session_id,shop_name,bill_total_paise,bill_status,included_in_actual,uploaded_at,updated_at) VALUES('b-self','u1','s1','Self',10000,'verified',1,'t0','t0')")
try:
    db.execute("UPDATE shopping_actual_bills SET duplicate_of_bill_id='b-self' WHERE id='b-self'")
    db.execute("UPDATE shopping_actual_bills SET duplicate_of_bill_id=NULL WHERE id='b-self'")
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
assert db.execute(cycle_sql,("b-cycle-b","u1","s1","u1","s1","b-cycle-a")).fetchone() is not None
assert db.execute(cycle_sql,("b-cycle-a","u1","s1","u1","s1","b-cycle-a")).fetchone() is not None
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
assert linked_audit and json.loads(linked_audit[0])["dependent_duplicate_links"][0][0]=="b-dependent"
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
date_validator=(ROOT/"src/lib/date-validation.js").read_text(encoding="utf-8")
assert "date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day" in date_validator

# Source line numbering must be positive, unique, and avoid collisions when
# auto-numbering lines that arrive without explicit OCR line numbers.
assert "Source line numbers must be unique positive integers from 1 to 200." in engine
assert "Source line numbers must be unique." in engine
assert "const normalizedLineNumbers=lines.map(line=>" in engine
assert "normalizedLineNumbers[index]" in engine

# Prevent empty session and shop labels from creating unusable records.
assert 'const name=text(body.name,120);' in engine
assert 'if(!name)return fail("A shopping trip name is required.");' in engine
assert "if (body.name !== undefined) { patch.name = text(body.name,120); if(!patch.name)return fail(\"A shopping session name is required.\"); }" in engine
assert "if(!shopName)return fail(\"A shop name is required.\");" in engine
assert "if(body.shop_name!==undefined&&!patch.shop_name)return fail(\"A shop name is required.\");" in engine


# Seed the parent source list required by source-line foreign keys.
db.execute("""INSERT INTO shopping_source_lists (id,user_id,session_id,source_type,ocr_status,created_at)
              VALUES (?,?,?,?,?,?)""", ("sl1","u1","s1","manual_entry","not_applicable","t0"))

# Item merge source-line links: duplicate source references must be removed from
# the cancelled source item, while non-duplicate references transfer to target.
for item_id in ["merge-source","merge-target"]:
    db.execute("INSERT INTO shopping_items (id,user_id,session_id,product_name,normalized_name,planned_quantity,unit,item_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
               (item_id,"u1","s1",item_id,item_id,1,"pcs","planned","t0","t0"))
for source_id in ["merge-line-duplicate","merge-line-transfer"]:
    db.execute("INSERT INTO shopping_source_lines (id,user_id,session_id,source_list_id,line_number,original_name,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
               (source_id,"u1","s1","sl1",1,source_id,"t0","t0"))
db.execute("INSERT INTO shopping_item_sources (id,user_id,session_id,shopping_item_id,source_line_id,created_at) VALUES (?,?,?,?,?,?)",
           ("merge-link-source-dup","u1","s1","merge-source","merge-line-duplicate","t0"))
db.execute("INSERT INTO shopping_item_sources (id,user_id,session_id,shopping_item_id,source_line_id,created_at) VALUES (?,?,?,?,?,?)",
           ("merge-link-target-dup","u1","s1","merge-target","merge-line-duplicate","t0"))
db.execute("INSERT INTO shopping_item_sources (id,user_id,session_id,shopping_item_id,source_line_id,created_at) VALUES (?,?,?,?,?,?)",
           ("merge-link-source-transfer","u1","s1","merge-source","merge-line-transfer","t0"))
db.execute("DELETE FROM shopping_item_sources WHERE shopping_item_id=? AND source_line_id IN (SELECT source_line_id FROM shopping_item_sources WHERE shopping_item_id=?) AND user_id=? AND session_id=?",
           ("merge-source","merge-target","u1","s1"))
db.execute("UPDATE shopping_item_sources SET shopping_item_id=? WHERE shopping_item_id=? AND user_id=? AND session_id=?",
           ("merge-target","merge-source","u1","s1"))
assert db.execute("SELECT COUNT(*) FROM shopping_item_sources WHERE shopping_item_id='merge-source'").fetchone()[0]==0
assert db.execute("SELECT COUNT(*) FROM shopping_item_sources WHERE shopping_item_id='merge-target'").fetchone()[0]==2
assert db.execute("SELECT COUNT(*) FROM shopping_item_sources WHERE shopping_item_id='merge-target' AND source_line_id='merge-line-duplicate'").fetchone()[0]==1
assert "DELETE FROM shopping_item_sources WHERE shopping_item_id=? AND source_line_id IN (SELECT source_line_id FROM shopping_item_sources WHERE shopping_item_id=?)" in engine
assert "UPDATE shopping_item_sources SET shopping_item_id=? WHERE shopping_item_id=?" in engine

# Reconciliation must not trust a stale line amount after quantity/unit price edits.
assert 'if((body.quantity!==undefined||body.unit_price_paise!==undefined)&&body.line_amount_paise===undefined)patch.line_amount_paise=null;' in engine
# Explicit line amount in the same request is preserved as a deliberate correction.
assert 'body.line_amount_paise===undefined' in engine and 'patch.line_amount_paise=null' in engine

# Bill-line routes must capture both bill ID and line ID. The previous one-group
# regex caused edits/deletions to bind the bill ID as the line ID (404).
import re
line_route_pattern = re.compile(r"^bills/([a-f0-9-]{36})/lines/([a-f0-9-]{36})$")
sample_bill_id = "a" * 36
sample_line_id = "b" * 36
route_match = line_route_pattern.fullmatch(f"bills/{sample_bill_id}/lines/{sample_line_id}")
assert route_match and route_match.group(1) == sample_bill_id and route_match.group(2) == sample_line_id
assert 'const purchaseLineMatch=/^bills\\/([a-f0-9-]{36})\\/lines\\/([a-f0-9-]{36})$/i.exec(subpath);' in engine
assert 'const routeBillId=purchaseLineMatch[1],lineId=purchaseLineMatch[2];' in engine
assert 'if(!line||line.bill_id!==routeBillId)return fail("Bill line not found.",404);' in engine

# Bill-line deletion must use retry-safe keys in the API and retain the key in
# the UI until a successful response, so a lost response can be replayed.
delete_start = engine.index('if(purchaseLineMatch && method==="DELETE"){')
delete_end = engine.index('if(subpath==="confirm" && method==="POST"){', delete_start)
delete_handler = engine[delete_start:delete_end]
for required in ["Idempotency-Key", "bill_line_delete:", "shopping_idempotency_keys",
                "INSERT INTO shopping_idempotency_keys", "db.batch(statements)"]:
    assert required in delete_handler, f"Missing bill-line deletion retry safeguard: {required}"
session_ui = (ROOT / "src/routes/_authed/sessions/$sessionId.jsx").read_text(encoding="utf-8")
delete_ui_start = session_ui.index("const deleteBillLine = async")
delete_ui_end = session_ui.index("const handleScannedList", delete_ui_start)
delete_ui_handler = session_ui[delete_ui_start:delete_ui_end]
assert "billLineDeleteRequestKeysRef.current[lineId]" in delete_ui_handler
assert 'headers: { "Idempotency-Key": requestKey }' in delete_ui_handler
assert "delete billLineDeleteRequestKeysRef.current[lineId]" in delete_ui_handler

print("PASS: bill deletion, cleanup, auditing, retry, source-line merge integrity and file-preservation checks.")
