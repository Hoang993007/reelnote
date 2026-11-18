-- Team access. A share row still means "can open the source"; `can_write` adds "can change it":
-- its details, pages, videos, imports and every note on it. The owner reads and writes everything.
-- Existing shares stay read only.
ALTER TABLE `source_shares` ADD COLUMN `can_write` INTEGER NOT NULL DEFAULT 0;
