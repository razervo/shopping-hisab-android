#!/usr/bin/env python3
"""Regression checks for bill-to-item purchase progress and reconciliation integrity."""
from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parents[1]
db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys=ON")
for migration in sorted((ROOT / "migrations-native").glob("*.sql")):
    db.executescript(migration.read_text(encoding="utf-8"))
db.execute('INSERT INTO "user" (id,name,email) VALUES (?,?,?)', ("u1","QA User","qa@example.test"))
db.execute("""INSERT INTO shopping_sessions (id,user_id,name,shopping_date,status,created_at,updated_at)
VALUES (?,?,?,?,?,?,?)""", ("s1","u1","QA trip","2026-11-24","open","t0","t0"))
db.executemany("""INSERT INTO shopping_items
(id,user_id,session_id,product_name,normalized_name,planned_quantity,unit,item_status,created_at,updated_at)
VALUES (?,?,?,?,?,?,?,?,?,?)""",
[("i1","u1","s1","Rice","rice",5,"kg","planned","t0","t0"),
 ("i2","u1","s1","Oil","oil",2,"L","planned","t0","t0")])
db.execute("""INSERT INTO shopping_actual_bills
(id,user_id,session_id,shop_name,bill_total_paise,bill_status,included_in_actual,uploaded_at,updated_at)
VALUES (?,?,?,?,?,?,?,?,?)""", ("b1","u1","s1","QA Shop",5000,"verified",1,"t0","t0"))
db.executemany("""INSERT INTO shopping_purchase_lines
(id,user_id,session_id,bill_id,shopping_item_id,product_name,normalized_name,quantity,unit,line_amount_paise,is_extra,match_method,created_at,updated_at)
VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
[("l1","u1","s1","b1","i1","Rice","rice",2,"kg",2000,0,"confirmed","t0","t0"),
 ("l2","u1","s1","b1","i1","Rice","rice",500,"g",500,0,"suggested","t0","t0"),
 ("l3","u1","s1","b1",None,"Extra item","extra item",1,"pcs",2500,1,"extra","t0","t0")])

# Mirrors sessionDetail's purchased/remaining aggregation.
def progress(item_id):
    return db.execute("""SELECT i.planned_quantity,i.unit,
COALESCE(p.purchased_quantity,0),
MAX(i.planned_quantity-COALESCE(p.purchased_quantity,0),0),
COALESCE(p.purchase_count,0),COALESCE(p.unit_mismatch_count,0)
FROM shopping_items i LEFT JOIN (
SELECT pl.shopping_item_id,
SUM(CASE WHEN LOWER(TRIM(pl.unit))=LOWER(TRIM(i2.unit)) THEN pl.quantity ELSE 0 END) purchased_quantity,
SUM(CASE WHEN LOWER(TRIM(pl.unit))<>LOWER(TRIM(i2.unit)) THEN 1 ELSE 0 END) unit_mismatch_count,
COUNT(CASE WHEN LOWER(TRIM(pl.unit))=LOWER(TRIM(i2.unit)) THEN 1 END) purchase_count
FROM shopping_purchase_lines pl
INNER JOIN shopping_actual_bills b ON b.id=pl.bill_id AND b.user_id=pl.user_id AND b.session_id=pl.session_id
INNER JOIN shopping_items i2 ON i2.id=pl.shopping_item_id AND i2.user_id=pl.user_id AND i2.session_id=pl.session_id
WHERE pl.user_id=? AND pl.session_id=? AND pl.shopping_item_id IS NOT NULL
AND b.included_in_actual=1 AND b.bill_status NOT IN ('duplicate','void')
GROUP BY pl.shopping_item_id
) p ON p.shopping_item_id=i.id WHERE i.id=? AND i.user_id=? AND i.session_id=?""",
("u1","s1",item_id,"u1","s1")).fetchone()

# 2 kg counts, 500 g is flagged but not silently converted; unlinked extra ignored.
assert progress("i1") == (5.0,"kg",2.0,3.0,1,1), progress("i1")
assert progress("i2") == (2.0,"L",0.0,2.0,0,0), progress("i2")
# Removing the matched line changes progress immediately.
db.execute("DELETE FROM shopping_purchase_lines WHERE id='l1'")
assert progress("i1") == (5.0,"kg",0.0,5.0,0,1), progress("i1")
# Correcting the mismatch to kg makes it count; changing it back restores the warning.
db.execute("UPDATE shopping_purchase_lines SET quantity=0.5,unit='kg' WHERE id='l2'")
assert progress("i1") == (5.0,"kg",0.5,4.5,1,0), progress("i1")
db.execute("UPDATE shopping_purchase_lines SET unit='g' WHERE id='l2'")
assert progress("i1") == (5.0,"kg",0.0,5.0,0,1), progress("i1")
# Reassigning the bill line to Oil changes both items' progress correctly.
db.execute("UPDATE shopping_purchase_lines SET shopping_item_id='i2',unit='L',quantity=1 WHERE id='l2'")
assert progress("i1") == (5.0,"kg",0.0,5.0,0,0), progress("i1")
assert progress("i2") == (2.0,"L",1.0,1.0,1,0), progress("i2")
assert not db.execute("PRAGMA foreign_key_check").fetchall()
print("PASS: reconciliation progress verified for unit mismatch, extra line, deletion, correction and relinking.")


# Second-pass bill reconciliation coverage: route behavior must stay aligned with
# bill-level line-total refreshes, edits, and receipt-total corrections.
engine = (ROOT / "src/lib/shopping-engine.server.js").read_text(encoding="utf-8")
detail_start = engine.index("async function sessionDetail(")
detail_end = engine.index("export async function handleShoppingEngine", detail_start)
detail_query = engine[detail_start:detail_end]
assert "b.included_in_actual=1" in detail_query
assert "b.bill_status NOT IN ('duplicate','void')" in detail_query
assert "bills_amount_pending" in detail_query

session_list_start = engine.index('if (path === "/sessions" && method === "GET")')
session_list_end = engine.index('if (path === "/sessions" && method === "POST")', session_list_start)
session_list_query = engine[session_list_start:session_list_end]
assert "included_in_actual=1" in session_list_query
assert "bill_status NOT IN ('duplicate','void')" in session_list_query

bill_patch_start = engine.index('if (billMatch && ["GET","PATCH"].includes(method))')
bill_patch_end = engine.index("const purchaseLinesMatch=", bill_patch_start)
bill_patch_handler = engine[bill_patch_start:bill_patch_end]
assert "const effectiveTotal" in bill_patch_handler and "const effectiveLines" in bill_patch_handler
assert "reconciliation_difference_paise" in bill_patch_handler

line_patch_start = engine.index('if(purchaseLineMatch && method==="PATCH"){')
line_patch_end = engine.index('if(purchaseLineMatch && method==="DELETE"){', line_patch_start)
line_patch_handler = engine[line_patch_start:line_patch_end]
assert 'if((body.quantity!==undefined||body.unit_price_paise!==undefined)&&body.line_amount_paise===undefined)patch.line_amount_paise=null;' in line_patch_handler
assert "UPDATE shopping_actual_bills SET" in line_patch_handler
assert "reconciliation_difference_paise=CASE" in line_patch_handler
assert 'if(!line||line.bill_id!==routeBillId)return fail("Bill line not found.",404);' in line_patch_handler

line_create_start = engine.index('if(purchaseLinesMatch && method==="POST"){')
line_create_end = engine.index("const purchaseLineMatch=", line_create_start)
line_create_handler = engine[line_create_start:line_create_end]
assert "reconciliation_difference_paise=CASE" in line_create_handler
assert "await db.batch(statements)" in line_create_handler

line_delete_start = engine.index('if(purchaseLineMatch && method==="DELETE"){')
line_delete_end = engine.index('if(subpath==="confirm" && method==="POST"){', line_delete_start)
line_delete_handler = engine[line_delete_start:line_delete_end]
assert "reconciliation_difference_paise=CASE" in line_delete_handler
assert "await db.batch(statements)" in line_delete_handler

# Model the reconciliation cases that the route assertions above guard:
# complete line pricing, invalidation after quantity edit, explicit override,
# line deletion, bill-total correction, and a missing amount.
db.execute("""INSERT INTO shopping_actual_bills
(id,user_id,session_id,shop_name,bill_total_paise,bill_status,included_in_actual,line_total_paise,reconciliation_difference_paise,uploaded_at,updated_at)
VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
("b2","u1","s1","QA Shop 2",4500,"verified",1,None,None,"t0","t0"))
db.executemany("""INSERT INTO shopping_purchase_lines
(id,user_id,session_id,bill_id,product_name,normalized_name,quantity,unit,line_amount_paise,is_extra,match_method,created_at,updated_at)
VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
[("l4","u1","s1","b2","Item A","item a",2,"pcs",2000,0,"confirmed","t0","t0"),
 ("l5","u1","s1","b2","Item B","item b",1,"pcs",1500,0,"confirmed","t0","t0")])

def refresh_reconciliation(bill_id):
    rows = db.execute("SELECT line_amount_paise FROM shopping_purchase_lines WHERE bill_id=? AND user_id=? AND session_id=?",
                      (bill_id,"u1","s1")).fetchall()
    amounts = [row[0] for row in rows]
    complete = all(amount is not None for amount in amounts)
    line_total = sum(amounts) if complete else None
    bill_total = db.execute("SELECT bill_total_paise FROM shopping_actual_bills WHERE id=? AND user_id=? AND session_id=?",
                            (bill_id,"u1","s1")).fetchone()[0]
    difference = bill_total-line_total if complete and bill_total is not None else None
    db.execute("UPDATE shopping_actual_bills SET line_total_paise=?,reconciliation_difference_paise=? WHERE id=?",
              (line_total,difference,bill_id))
    return line_total,difference

assert refresh_reconciliation("b2") == (3500,1000)
# Quantity change without an explicit new row amount must invalidate the old amount.
db.execute("UPDATE shopping_purchase_lines SET quantity=3,line_amount_paise=NULL WHERE id='l4'")
assert refresh_reconciliation("b2") == (None,None)
# A user-entered row total is accepted as the new explicit amount.
db.execute("UPDATE shopping_purchase_lines SET line_amount_paise=2500 WHERE id='l4'")
assert refresh_reconciliation("b2") == (4000,500)
# Removing a priced line recalculates totals from the remaining rows.
db.execute("DELETE FROM shopping_purchase_lines WHERE id='l4'")
assert refresh_reconciliation("b2") == (1500,3000)
# Correcting the receipt total changes only the difference, not the line sum.
db.execute("UPDATE shopping_actual_bills SET bill_total_paise=5000 WHERE id='b2'")
assert refresh_reconciliation("b2") == (1500,3500)
# A single missing line amount makes reconciliation unknown rather than partial.
db.execute("UPDATE shopping_purchase_lines SET line_amount_paise=NULL WHERE id='l5'")
assert refresh_reconciliation("b2") == (None,None)
assert not db.execute("PRAGMA foreign_key_check").fetchall()
print("PASS: second-pass bill reconciliation covered totals, edits, deletion, receipt-total corrections and missing prices.")
