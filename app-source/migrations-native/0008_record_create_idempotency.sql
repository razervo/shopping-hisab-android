-- Idempotency for legacy shopping record creation (additive).
CREATE TABLE IF NOT EXISTS record_create_idempotency (
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  record_id TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, idempotency_key),
  UNIQUE (record_id)
);
CREATE INDEX IF NOT EXISTS idx_record_create_idempotency_created
  ON record_create_idempotency(created_at);
