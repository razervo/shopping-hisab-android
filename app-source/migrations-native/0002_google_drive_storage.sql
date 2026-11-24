-- Move private attachment metadata to per-user Google Drive storage.
-- Existing R2 key column is retained for safe future compatibility.
ALTER TABLE "user" ADD COLUMN googleDriveFolderId TEXT;
ALTER TABLE uploaded_files ADD COLUMN storage_provider TEXT NOT NULL DEFAULT 'google_drive';
ALTER TABLE uploaded_files ADD COLUMN drive_file_id TEXT;
