-- Shopping Hisab: additive shopping-session, estimate and actual-purchase engine.
-- Migration: 0005_shopping_engine.sql
--
-- SAFETY:
--   * Additive only. Existing tables and columns are not dropped or rewritten.
--   * Existing shopping_records and uploaded_files remain the legacy compatibility layer.
--   * Legacy shopping_records are mapped to open shopping_sessions and source-list
--     metadata. Their items_json remains untouched; detailed line backfill is an
--     application migration step so original JSON is never destructively rewritten.
--   * This file is prepared on the feature branch only. It has NOT been executed.
--
-- Money in the new engine is stored as integer paise to avoid floating-point drift.
-- A bill's bill_total_paise is the accounting amount. Purchase lines explain that
-- bill and MUST NOT be added to bill totals a second time.
--
-- Uploaded bills are included in the running actual total by default
-- (included_in_actual = 1). Bills with unreadable totals remain visible as
-- amount-pending and contribute no fabricated amount. Duplicate/void decisions
-- must explicitly set included_in_actual = 0 and be audit logged.

CREATE TABLE IF NOT EXISTS shopping_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  shopping_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'ready_to_confirm', 'completed')),
  latest_estimate_id TEXT,
  confirmed_actual_total_paise INTEGER
    CHECK (confirmed_actual_total_paise IS NULL OR confirmed_actual_total_paise >= 0),
  legacy_record_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (id, user_id),
  UNIQUE (user_id, legacy_record_id),
  FOREIGN KEY (legacy_record_id) REFERENCES shopping_records(id)
);

CREATE INDEX IF NOT EXISTS idx_shopping_sessions_user_status_date
  ON shopping_sessions(user_id, status, shopping_date DESC);
CREATE INDEX IF NOT EXISTS idx_shopping_sessions_user_updated
  ON shopping_sessions(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS shopping_source_lists (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  source_type TEXT NOT NULL
    CHECK (source_type IN ('handwritten_scan', 'manual_entry', 'imported_list', 'legacy_record')),
  file_id TEXT REFERENCES uploaded_files(id) ON DELETE SET NULL,
  original_file_uri TEXT,
  legacy_record_id TEXT,
  ocr_status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (ocr_status IN ('not_started', 'processing', 'completed', 'needs_review', 'failed', 'not_applicable')),
  source_metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (id, session_id, user_id),
  UNIQUE (user_id, legacy_record_id),
  FOREIGN KEY (session_id, user_id)
    REFERENCES shopping_sessions(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (legacy_record_id)
    REFERENCES shopping_records(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_shopping_source_lists_session
  ON shopping_source_lists(user_id, session_id, created_at);

CREATE TABLE IF NOT EXISTS shopping_source_lines (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  source_list_id TEXT NOT NULL,
  line_number INTEGER NOT NULL DEFAULT 0,
  original_name TEXT NOT NULL DEFAULT '',
  recognized_name TEXT NOT NULL DEFAULT '',
  brand TEXT NOT NULL DEFAULT '',
  product_type TEXT NOT NULL DEFAULT 'unsure',
  pack_size TEXT NOT NULL DEFAULT '',
  quantity REAL,
  unit TEXT NOT NULL DEFAULT '',
  ocr_confidence REAL
    CHECK (ocr_confidence IS NULL OR (ocr_confidence >= 0 AND ocr_confidence <= 1)),
  original_ocr_json TEXT NOT NULL DEFAULT '{}',
  corrected_values_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (id, session_id, user_id),
  FOREIGN KEY (source_list_id, session_id, user_id)
    REFERENCES shopping_source_lists(id, session_id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_shopping_source_lines_list
  ON shopping_source_lines(user_id, source_list_id, line_number);

CREATE TABLE IF NOT EXISTS shopping_items (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL DEFAULT '',
  brand TEXT NOT NULL DEFAULT '',
  product_type TEXT NOT NULL DEFAULT 'unsure',
  pack_size TEXT NOT NULL DEFAULT '',
  planned_quantity REAL NOT NULL DEFAULT 0 CHECK (planned_quantity >= 0),
  unit TEXT NOT NULL DEFAULT 'pcs',
  item_status TEXT NOT NULL DEFAULT 'planned'
    CHECK (item_status IN ('planned', 'pending', 'partially_purchased', 'purchased', 'cancelled')),
  merged_into_item_id TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (id, session_id, user_id),
  FOREIGN KEY (session_id, user_id)
    REFERENCES shopping_sessions(id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_shopping_items_session
  ON shopping_items(user_id, session_id, item_status);
CREATE INDEX IF NOT EXISTS idx_shopping_items_normalized
  ON shopping_items(user_id, session_id, normalized_name);

CREATE TABLE IF NOT EXISTS shopping_item_sources (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  shopping_item_id TEXT NOT NULL,
  source_line_id TEXT NOT NULL,
  merged_quantity REAL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (shopping_item_id, source_line_id),
  FOREIGN KEY (shopping_item_id, session_id, user_id)
    REFERENCES shopping_items(id, session_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (source_line_id, session_id, user_id)
    REFERENCES shopping_source_lines(id, session_id, user_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_shopping_item_sources_item
  ON shopping_item_sources(user_id, shopping_item_id);
CREATE INDEX IF NOT EXISTS idx_shopping_item_sources_source
  ON shopping_item_sources(user_id, source_line_id);

CREATE TABLE IF NOT EXISTS shopping_estimates (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  estimated_total_paise INTEGER NOT NULL DEFAULT 0 CHECK (estimated_total_paise >= 0),
  currency TEXT NOT NULL DEFAULT 'INR',
  calculation_source TEXT NOT NULL DEFAULT 'mixed'
    CHECK (calculation_source IN ('previous_purchase', 'market_data', 'manual', 'ai_estimate', 'mixed')),
  market_area TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (id, session_id, user_id),
  UNIQUE (session_id, user_id, version_number),
  FOREIGN KEY (session_id, user_id)
    REFERENCES shopping_sessions(id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_shopping_estimates_session_version
  ON shopping_estimates(user_id, session_id, version_number DESC);

CREATE TABLE IF NOT EXISTS shopping_estimate_lines (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  estimate_id TEXT NOT NULL,
  shopping_item_id TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  unit TEXT NOT NULL DEFAULT 'pcs',
  estimated_unit_price_paise INTEGER NOT NULL DEFAULT 0
    CHECK (estimated_unit_price_paise >= 0),
  estimated_line_total_paise INTEGER NOT NULL DEFAULT 0
    CHECK (estimated_line_total_paise >= 0),
  price_source TEXT NOT NULL
    CHECK (price_source IN ('previous_purchase', 'market_data', 'manual', 'ai_estimate')),
  source_reference TEXT NOT NULL DEFAULT '',
  source_observed_at TEXT,
  confidence REAL
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (estimate_id, session_id, user_id)
    REFERENCES shopping_estimates(id, session_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (shopping_item_id, session_id, user_id)
    REFERENCES shopping_items(id, session_id, user_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_shopping_estimate_lines_estimate
  ON shopping_estimate_lines(user_id, estimate_id);

CREATE TABLE IF NOT EXISTS shopping_actual_bills (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  shop_name TEXT NOT NULL DEFAULT '',
  purchase_date TEXT,
  file_id TEXT REFERENCES uploaded_files(id) ON DELETE SET NULL,
  original_file_uri TEXT,
  receipt_number TEXT NOT NULL DEFAULT '',
  subtotal_paise INTEGER CHECK (subtotal_paise IS NULL OR subtotal_paise >= 0),
  tax_paise INTEGER CHECK (tax_paise IS NULL OR tax_paise >= 0),
  discount_paise INTEGER CHECK (discount_paise IS NULL OR discount_paise >= 0),
  other_charges_paise INTEGER CHECK (other_charges_paise IS NULL OR other_charges_paise >= 0),
  bill_total_paise INTEGER CHECK (bill_total_paise IS NULL OR bill_total_paise >= 0),
  line_total_paise INTEGER CHECK (line_total_paise IS NULL OR line_total_paise >= 0),
  reconciliation_difference_paise INTEGER,
  bill_status TEXT NOT NULL DEFAULT 'uploaded'
    CHECK (bill_status IN ('uploaded', 'needs_review', 'verified', 'duplicate', 'void')),
  included_in_actual INTEGER NOT NULL DEFAULT 1
    CHECK (included_in_actual IN (0, 1)),
  duplicate_fingerprint TEXT,
  duplicate_of_bill_id TEXT,
  original_ocr_json TEXT NOT NULL DEFAULT '{}',
  corrected_values_json TEXT,
  uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (id, session_id, user_id),
  FOREIGN KEY (session_id, user_id)
    REFERENCES shopping_sessions(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (duplicate_of_bill_id, session_id, user_id)
    REFERENCES shopping_actual_bills(id, session_id, user_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_shopping_actual_bills_session_date
  ON shopping_actual_bills(user_id, session_id, purchase_date);
CREATE INDEX IF NOT EXISTS idx_shopping_actual_bills_accounting
  ON shopping_actual_bills(user_id, session_id, included_in_actual, bill_status);
CREATE INDEX IF NOT EXISTS idx_shopping_actual_bills_fingerprint
  ON shopping_actual_bills(user_id, session_id, duplicate_fingerprint);

CREATE TABLE IF NOT EXISTS shopping_purchase_lines (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  bill_id TEXT NOT NULL,
  shopping_item_id TEXT,
  product_name TEXT NOT NULL DEFAULT '',
  normalized_name TEXT NOT NULL DEFAULT '',
  brand TEXT NOT NULL DEFAULT '',
  pack_size TEXT NOT NULL DEFAULT '',
  quantity REAL NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  unit TEXT NOT NULL DEFAULT 'pcs',
  unit_price_paise INTEGER CHECK (unit_price_paise IS NULL OR unit_price_paise >= 0),
  line_amount_paise INTEGER CHECK (line_amount_paise IS NULL OR line_amount_paise >= 0),
  is_extra INTEGER NOT NULL DEFAULT 0 CHECK (is_extra IN (0, 1)),
  match_method TEXT NOT NULL DEFAULT 'unmatched'
    CHECK (match_method IN ('exact', 'confirmed', 'suggested', 'unmatched', 'extra')),
  original_ocr_json TEXT NOT NULL DEFAULT '{}',
  corrected_values_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (id, session_id, user_id),
  FOREIGN KEY (bill_id, session_id, user_id)
    REFERENCES shopping_actual_bills(id, session_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (shopping_item_id, session_id, user_id)
    REFERENCES shopping_items(id, session_id, user_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_shopping_purchase_lines_bill
  ON shopping_purchase_lines(user_id, bill_id);
CREATE INDEX IF NOT EXISTS idx_shopping_purchase_lines_item
  ON shopping_purchase_lines(user_id, session_id, shopping_item_id);

CREATE TABLE IF NOT EXISTS shopping_audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id, user_id)
    REFERENCES shopping_sessions(id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_shopping_audit_session_time
  ON shopping_audit_events(user_id, session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_shopping_audit_entity
  ON shopping_audit_events(user_id, entity_type, entity_id);

CREATE TABLE IF NOT EXISTS shopping_expense_confirmations (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  revision_number INTEGER NOT NULL CHECK (revision_number > 0),
  calculated_total_paise INTEGER NOT NULL CHECK (calculated_total_paise >= 0),
  confirmed_total_paise INTEGER NOT NULL CHECK (confirmed_total_paise >= 0),
  estimate_id TEXT,
  calculation_snapshot_json TEXT NOT NULL,
  confirmed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (session_id, user_id, revision_number),
  FOREIGN KEY (session_id, user_id)
    REFERENCES shopping_sessions(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (estimate_id, session_id, user_id)
    REFERENCES shopping_estimates(id, session_id, user_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_shopping_expense_confirmations_session
  ON shopping_expense_confirmations(user_id, session_id, revision_number DESC);

-- Estimate versions and their lines are snapshots: create a new version rather
-- than editing an earlier estimate. Application code should use INSERT only.
CREATE TRIGGER IF NOT EXISTS trg_shopping_estimates_no_update
BEFORE UPDATE ON shopping_estimates
BEGIN
  SELECT RAISE(ABORT, 'Estimate versions are immutable; create a new version.');
END;

CREATE TRIGGER IF NOT EXISTS trg_shopping_estimates_no_delete
BEFORE DELETE ON shopping_estimates
BEGIN
  SELECT RAISE(ABORT, 'Estimate versions are immutable.');
END;

CREATE TRIGGER IF NOT EXISTS trg_shopping_estimate_lines_no_update
BEFORE UPDATE ON shopping_estimate_lines
BEGIN
  SELECT RAISE(ABORT, 'Estimate lines are immutable; create a new estimate version.');
END;

CREATE TRIGGER IF NOT EXISTS trg_shopping_estimate_lines_no_delete
BEFORE DELETE ON shopping_estimate_lines
BEGIN
  SELECT RAISE(ABORT, 'Estimate lines are immutable.');
END;

-- Append-only audit trail. Corrections are represented by new events.
CREATE TRIGGER IF NOT EXISTS trg_shopping_audit_events_no_update
BEFORE UPDATE ON shopping_audit_events
BEGIN
  SELECT RAISE(ABORT, 'Audit events are append-only.');
END;

CREATE TRIGGER IF NOT EXISTS trg_shopping_audit_events_no_delete
BEFORE DELETE ON shopping_audit_events
BEGIN
  SELECT RAISE(ABORT, 'Audit events are append-only.');
END;

-- Backfill a session shell for every existing legacy record. The original
-- shopping_records row and items_json remain the source of truth until the
-- application performs a verified, non-destructive line-level backfill.
INSERT INTO shopping_sessions (
  id, user_id, name, shopping_date, status, legacy_record_id, created_at, updated_at
)
SELECT
  'legacy-session-' || r.id,
  r.user_id,
  CASE WHEN trim(r.shop_name) <> '' THEN r.shop_name ELSE 'Imported shopping session' END,
  r.date,
  'open',
  r.id,
  r.created_at,
  r.updated_at
FROM shopping_records AS r
WHERE NOT EXISTS (
  SELECT 1
  FROM shopping_sessions AS s
  WHERE s.user_id = r.user_id
    AND s.legacy_record_id = r.id
);

-- Preserve the legacy record and its existing bill attachment as a source-list
-- reference. Detailed item rows are intentionally not guessed from JSON here.
INSERT INTO shopping_source_lists (
  id, user_id, session_id, source_type, file_id, original_file_uri,
  legacy_record_id, ocr_status, source_metadata_json, created_at
)
SELECT
  'legacy-source-' || r.id,
  r.user_id,
  'legacy-session-' || r.id,
  'legacy_record',
  r.bill_file_id,
  r.legacy_bill_file_uri,
  r.id,
  'not_applicable',
  '{}',
  r.created_at
FROM shopping_records AS r
WHERE NOT EXISTS (
  SELECT 1
  FROM shopping_source_lists AS l
  WHERE l.user_id = r.user_id
    AND l.legacy_record_id = r.id
);
