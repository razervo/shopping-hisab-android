-- Shopping Hisab development hardening: idempotency ledger for retried mutations.
-- Additive only; existing business data is untouched.
CREATE TABLE IF NOT EXISTS shopping_idempotency_keys (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  session_id TEXT,
  operation TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, operation, idempotency_key),
  FOREIGN KEY (session_id, user_id)
    REFERENCES shopping_sessions(id, user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_shopping_idempotency_created
  ON shopping_idempotency_keys(created_at);
