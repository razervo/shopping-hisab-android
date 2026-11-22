-- Retain a minimal tombstone for safely deleted, truly empty shopping trips.
-- The log intentionally has no FK to shopping_sessions so it survives the session cascade.
CREATE TABLE IF NOT EXISTS shopping_session_deletion_log (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  deleted_session_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  session_snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, deleted_session_id),
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_shopping_session_deletion_log_created
  ON shopping_session_deletion_log(user_id, created_at DESC);
