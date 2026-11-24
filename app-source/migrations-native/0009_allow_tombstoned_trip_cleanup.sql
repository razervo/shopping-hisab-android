-- Permit immutable estimate/audit records to be physically cleaned up only as part of
-- an explicitly tombstoned shopping-trip deletion. Normal application DELETEs
-- remain blocked; the tombstone must exist before cleanup begins.
DROP TRIGGER IF EXISTS trg_shopping_estimate_lines_no_delete;
CREATE TRIGGER trg_shopping_estimate_lines_no_delete
BEFORE DELETE ON shopping_estimate_lines
WHEN NOT EXISTS (
  SELECT 1 FROM shopping_session_deletion_log d
  WHERE d.user_id=OLD.user_id AND d.deleted_session_id=OLD.session_id
)
BEGIN
  SELECT RAISE(ABORT, 'Estimate lines are immutable.');
END;

DROP TRIGGER IF EXISTS trg_shopping_estimates_no_delete;
CREATE TRIGGER trg_shopping_estimates_no_delete
BEFORE DELETE ON shopping_estimates
WHEN NOT EXISTS (
  SELECT 1 FROM shopping_session_deletion_log d
  WHERE d.user_id=OLD.user_id AND d.deleted_session_id=OLD.session_id
)
BEGIN
  SELECT RAISE(ABORT, 'Estimate versions are immutable.');
END;

DROP TRIGGER IF EXISTS trg_shopping_audit_events_no_delete;
CREATE TRIGGER trg_shopping_audit_events_no_delete
BEFORE DELETE ON shopping_audit_events
WHEN NOT EXISTS (
  SELECT 1 FROM shopping_session_deletion_log d
  WHERE d.user_id=OLD.user_id AND d.deleted_session_id=OLD.session_id
)
BEGIN
  SELECT RAISE(ABORT, 'Audit events are append-only.');
END;
