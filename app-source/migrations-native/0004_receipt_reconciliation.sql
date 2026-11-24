-- Track each receipt independently so merged shopping lines remain auditable.
ALTER TABLE shopping_records ADD COLUMN receipts_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE shopping_records ADD COLUMN reconciliation_status TEXT NOT NULL DEFAULT 'not_required';
