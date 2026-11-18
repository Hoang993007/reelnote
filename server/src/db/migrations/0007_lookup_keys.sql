-- Word lookup keys set in the app: a user's own Gemini API key (used for their lookups). The shared key the
-- owner sets lives in `settings` (`gemini_api_key_shared`). Stored as typed: the owner chose no encryption.
ALTER TABLE `users` ADD COLUMN `gemini_api_key` TEXT;
