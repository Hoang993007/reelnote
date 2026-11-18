-- Accounts: everyone signs in with email + password, the owner included. A session row keeps only
-- the SHA-256 of its cookie token, so the table alone cannot sign anyone in.
CREATE TABLE `users` (
  `id`            INTEGER PRIMARY KEY AUTOINCREMENT,
  `email`         TEXT    NOT NULL UNIQUE,
  `display_name`  TEXT    NOT NULL,
  `password_hash` TEXT    NOT NULL,
  `role`          TEXT    NOT NULL CHECK (`role` IN ('owner', 'friend')),
  `created_at`    TEXT    NOT NULL DEFAULT (datetime('now')),
  `disabled_at`   TEXT
);

CREATE TABLE `sessions` (
  `id`           TEXT    PRIMARY KEY,
  `user_id`      INTEGER NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `created_at`   TEXT    NOT NULL,
  `expires_at`   TEXT    NOT NULL,
  `last_seen_at` TEXT    NOT NULL
);
CREATE INDEX `sessions_user_id_idx` ON `sessions` (`user_id`);
CREATE INDEX `sessions_expires_at_idx` ON `sessions` (`expires_at`);
