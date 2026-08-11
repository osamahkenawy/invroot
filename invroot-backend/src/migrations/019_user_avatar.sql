-- Profile picture for a user account.
--
-- `users.avatar_url` already existed but was never populated — the UI rendered
-- initials and nothing ever wrote to the column. Rather than store a bare path
-- there (the mistake this storage work just undid for logos), point at an
-- invroot_attachments row so the access check and the driver stay in one place.
--
-- Mirrors clients.avatar_attachment_id deliberately: same kind, same folder,
-- same private-by-default handling, so there is one avatar code path, not two.

ALTER TABLE users ADD COLUMN avatar_attachment_id BIGINT NULL AFTER avatar_url;
