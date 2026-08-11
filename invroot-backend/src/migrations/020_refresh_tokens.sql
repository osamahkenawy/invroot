-- Refresh tokens.
--
-- Until now the access token was the only credential and lasted 7 days. That is
-- a long time for a bearer token that also sits in localStorage: anything that
-- reads it (XSS, a shared machine, a log line) has a week of access.
--
-- Splitting it lets the access token be short-lived while the session still
-- feels continuous:
--
--   access token   — JWT, minutes. Never stored server-side.
--   refresh token  — opaque random bytes, stored HASHED, exchanged for a new
--                    access token and rotated on every use.
--
-- Only the SHA-256 of the refresh token is kept, for the same reason passwords
-- are hashed: a leaked database row must not be usable as a credential.
--
-- `previous_refresh_hash` is what makes theft detectable. Rotation means a used
-- token is immediately replaced; if that old value is ever presented again,
-- two parties hold the same token and one of them is an attacker. There is no
-- way to tell which, so the whole session is revoked and both must sign in.

ALTER TABLE user_sessions
  ADD COLUMN refresh_hash          CHAR(64) NULL AFTER user_agent,
  ADD COLUMN previous_refresh_hash CHAR(64) NULL AFTER refresh_hash,
  ADD COLUMN refresh_expires_at    DATETIME NULL AFTER previous_refresh_hash,
  -- A rolling refresh window would extend forever while someone keeps a tab
  -- open. This is the hard stop: past it, re-authentication is required no
  -- matter how active the session has been.
  ADD COLUMN absolute_expires_at   DATETIME NULL AFTER refresh_expires_at,
  ADD COLUMN rotated_at            DATETIME NULL AFTER absolute_expires_at,
  ADD COLUMN revoked_reason        VARCHAR(40) NULL AFTER revoked_at;

-- Refresh presents a token, not a session id, so the lookup is by hash.
CREATE INDEX idx_user_sessions_refresh ON user_sessions (refresh_hash);
CREATE INDEX idx_user_sessions_prev_refresh ON user_sessions (previous_refresh_hash);
