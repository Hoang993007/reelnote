-- Sharing and per-user data. One owner account owns every source and shares chosen ones with
-- friends. Blocks get an author: a friend sees the owner's blocks and their own; the owner sees
-- their own. Reading state and video progress become per user. Existing rows (from before
-- accounts) belong to the owner, when one exists; a NULL author means the owner.
CREATE TABLE `source_shares` (
  `source_id`  INTEGER NOT NULL REFERENCES `sources`(`id`) ON DELETE CASCADE,
  `user_id`    INTEGER NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `created_at` TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (`source_id`, `user_id`)
);
CREATE INDEX `source_shares_user_id_idx` ON `source_shares` (`user_id`);

ALTER TABLE `blocks` ADD COLUMN `author_id` INTEGER REFERENCES `users`(`id`) ON DELETE CASCADE;
UPDATE `blocks` SET `author_id` = (SELECT `id` FROM `users` WHERE `role` = 'owner');
CREATE INDEX `blocks_author_id_idx` ON `blocks` (`author_id`);

CREATE TABLE `page_reading_state_new` (
  `page_id`        INTEGER NOT NULL REFERENCES `pages`(`id`) ON DELETE CASCADE,
  `user_id`        INTEGER NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `last_block_id`  INTEGER REFERENCES `blocks`(`id`) ON DELETE SET NULL,
  `last_viewed_at` TEXT    NOT NULL,
  PRIMARY KEY (`page_id`, `user_id`)
);
INSERT INTO `page_reading_state_new` (`page_id`, `user_id`, `last_block_id`, `last_viewed_at`)
  SELECT r.`page_id`, o.`id`, r.`last_block_id`, r.`last_viewed_at`
  FROM `page_reading_state` r JOIN (SELECT `id` FROM `users` WHERE `role` = 'owner') o;
DROP TABLE `page_reading_state`;
ALTER TABLE `page_reading_state_new` RENAME TO `page_reading_state`;
CREATE INDEX `page_reading_state_user_viewed_idx` ON `page_reading_state` (`user_id`, `last_viewed_at`);

CREATE TABLE `video_progress` (
  `page_video_id`      INTEGER NOT NULL REFERENCES `page_videos`(`id`) ON DELETE CASCADE,
  `user_id`            INTEGER NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `last_position_sec`  REAL    NOT NULL DEFAULT 0,
  `completed`          INTEGER NOT NULL DEFAULT 0,
  `last_watched_at`    TEXT,
  `playback_client_ts` INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (`page_video_id`, `user_id`)
);
INSERT INTO `video_progress` (`page_video_id`, `user_id`, `last_position_sec`, `completed`, `last_watched_at`, `playback_client_ts`)
  SELECT v.`id`, o.`id`, v.`last_position_sec`, v.`completed`, v.`last_watched_at`, v.`playback_client_ts`
  FROM `page_videos` v JOIN (SELECT `id` FROM `users` WHERE `role` = 'owner') o
  WHERE v.`last_watched_at` IS NOT NULL OR v.`completed` = 1 OR v.`last_position_sec` > 0;
ALTER TABLE `page_videos` DROP COLUMN `last_position_sec`;
ALTER TABLE `page_videos` DROP COLUMN `completed`;
ALTER TABLE `page_videos` DROP COLUMN `last_watched_at`;
ALTER TABLE `page_videos` DROP COLUMN `playback_client_ts`;
