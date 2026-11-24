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
