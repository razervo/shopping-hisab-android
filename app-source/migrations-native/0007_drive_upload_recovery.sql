-- Shopping Hisab backend Drive-upload recovery reservations.
-- Additive hardening only. This migration is branch work; do not apply to production
-- until the application code and recovery tests are reviewed and approved.
CREATE TABLE IF NOT EXISTS drive_upload_idempotency (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'complete')),
  lease_token TEXT,
  drive_file_id TEXT,
  uploaded_file_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_drive_upload_recovery
  ON drive_upload_idempotency(user_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_drive_upload_drive_id
  ON drive_upload_idempotency(drive_file_id);
