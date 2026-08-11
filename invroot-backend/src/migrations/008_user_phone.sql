-- ── Add the missing users.phone column ─────────────────────────────────
--
-- The My Profile screen has always shown a Phone field, and
-- PUT /api/settings/profile has always written to `users.phone` — but the
-- column was never created. Every profile save failed with
-- "Unknown column 'phone' in 'field list'" (HTTP 500).
ALTER TABLE users ADD COLUMN phone VARCHAR(40) NULL AFTER full_name;
