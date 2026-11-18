-- Reelnote's starting schema: the original app's learning tables, so its data could be copied over
-- column for column. Plus `settings` and `managed_files`.
CREATE TABLE `settings` (
  `key`   TEXT PRIMARY KEY,
  `value` TEXT NOT NULL
);

CREATE TABLE `managed_files` (
  `id`         INTEGER PRIMARY KEY AUTOINCREMENT,
  `file_path`  TEXT    NOT NULL UNIQUE,
  `source`     TEXT    NOT NULL,
  `created_at` TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE `sources` (
  `id`           INTEGER PRIMARY KEY AUTOINCREMENT,
  `name`         TEXT    NOT NULL,
  `description`  TEXT,
  `avatar_path`  TEXT,
  `created_at`   TEXT    NOT NULL DEFAULT (datetime('now')),
  `uid`          TEXT    UNIQUE,
  `updated_at`   TEXT    NOT NULL,
  `deleted_at`   TEXT,
  `video_folder` TEXT
);

CREATE TABLE `source_insight_categories` (
  `id`         INTEGER PRIMARY KEY AUTOINCREMENT,
  `source_id`  INTEGER NOT NULL REFERENCES `sources`(`id`) ON DELETE CASCADE,
  `label`      TEXT    NOT NULL,
  `position`   INTEGER NOT NULL DEFAULT 0,
  `created_at` TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (`source_id`, `label`)
);

CREATE TABLE `pages` (
  `id`         INTEGER PRIMARY KEY AUTOINCREMENT,
  `source_id`  INTEGER NOT NULL REFERENCES `sources`(`id`) ON DELETE CASCADE,
  `title`      TEXT    NOT NULL,
  `video_url`  TEXT,
  `date`       TEXT,
  `position`   INTEGER NOT NULL DEFAULT 0,
  `created_at` TEXT    NOT NULL DEFAULT (datetime('now')),
  `uid`        TEXT    UNIQUE,
  `updated_at` TEXT    NOT NULL,
  `deleted_at` TEXT
);
CREATE INDEX `pages_source_id_idx` ON `pages` (`source_id`);

CREATE TABLE `page_videos` (
  `id`                 INTEGER PRIMARY KEY AUTOINCREMENT,
  `page_id`            INTEGER NOT NULL REFERENCES `pages`(`id`) ON DELETE CASCADE,
  `position`           INTEGER NOT NULL DEFAULT 0,
  `rel_path`           TEXT    NOT NULL,
  `rel_path_key`       TEXT    NOT NULL,
  `title`              TEXT    NOT NULL,
  `duration_sec`       REAL,
  `last_position_sec`  REAL    NOT NULL DEFAULT 0,
  `completed`          INTEGER NOT NULL DEFAULT 0,
  `last_watched_at`    TEXT,
  `playback_client_ts` INTEGER NOT NULL DEFAULT 0,
  `created_at`         TEXT    NOT NULL DEFAULT (datetime('now')),
  `uid`                TEXT    UNIQUE,
  `updated_at`         TEXT    NOT NULL
);
CREATE UNIQUE INDEX `page_videos_rel_path_key_unique` ON `page_videos` (`rel_path_key`);
CREATE INDEX `page_videos_page_id_idx` ON `page_videos` (`page_id`);

CREATE TABLE `blocks` (
  `id`               INTEGER PRIMARY KEY AUTOINCREMENT,
  `page_id`          INTEGER REFERENCES `pages`(`id`) ON DELETE CASCADE,
  `source_id`        INTEGER REFERENCES `sources`(`id`) ON DELETE CASCADE,
  `is_insight`       INTEGER NOT NULL DEFAULT 0,
  `insight_category` TEXT,
  `type`             TEXT    NOT NULL CHECK (`type` IN ('note')),
  `position`         INTEGER NOT NULL DEFAULT 0,
  `created_at`       TEXT    NOT NULL DEFAULT (datetime('now')),
  `tags`             TEXT,
  `pinned`           INTEGER NOT NULL DEFAULT 0,
  `color`            TEXT,
  `annotation`       TEXT,
  `image_layout`     TEXT    NOT NULL DEFAULT 'wrap' CHECK (`image_layout` IN ('wrap', 'row')),
  `uid`              TEXT    UNIQUE,
  `updated_at`       TEXT    NOT NULL,
  `deleted_at`       TEXT,
  `page_video_id`    INTEGER REFERENCES `page_videos`(`id`) ON DELETE SET NULL,
  `video_time_sec`   REAL
);
CREATE INDEX `blocks_page_id_idx` ON `blocks` (`page_id`);
CREATE INDEX `blocks_source_id_idx` ON `blocks` (`source_id`);
CREATE INDEX `blocks_page_video_id_idx` ON `blocks` (`page_video_id`);

CREATE TABLE `page_reading_state` (
  `page_id`        INTEGER PRIMARY KEY NOT NULL REFERENCES `pages`(`id`) ON DELETE CASCADE,
  `last_block_id`  INTEGER REFERENCES `blocks`(`id`) ON DELETE SET NULL,
  `last_viewed_at` TEXT    NOT NULL
);
CREATE INDEX `page_reading_state_last_viewed_idx` ON `page_reading_state` (`last_viewed_at`);

CREATE TABLE `block_text` (
  `block_id` INTEGER PRIMARY KEY REFERENCES `blocks`(`id`) ON DELETE CASCADE,
  `body`     TEXT
);

CREATE TABLE `block_images` (
  `id`            INTEGER PRIMARY KEY AUTOINCREMENT,
  `block_id`      INTEGER NOT NULL REFERENCES `blocks`(`id`) ON DELETE CASCADE,
  `file_path`     TEXT    NOT NULL,
  `position`      INTEGER NOT NULL DEFAULT 0,
  `caption`       TEXT,
  `display_size`  TEXT    NOT NULL DEFAULT 'full',
  `display_width` INTEGER,
  `crop_x`        REAL,
  `crop_y`        REAL,
  `crop_w`        REAL,
  `crop_h`        REAL,
  `markup`        TEXT
);
CREATE INDEX `block_images_block_id_idx` ON `block_images` (`block_id`);
CREATE INDEX `block_images_file_path_idx` ON `block_images` (`file_path`);
