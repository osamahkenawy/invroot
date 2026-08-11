-- Accounts provisioned by a platform admin get a temporary password emailed to
-- them. This flag forces the owner to set their own password on first sign-in;
-- it is cleared by POST /api/auth/change-password.

ALTER TABLE users ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0 AFTER password;
