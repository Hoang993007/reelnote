-- What the web UI needs on top of the split.
--
-- Sources: a kind, an author, a monogram colour and the owner's order (the rail and Home follow it).
ALTER TABLE `sources` ADD COLUMN `kind` TEXT CHECK (`kind` IN ('mentor', 'book', 'channel', 'course'));
ALTER TABLE `sources` ADD COLUMN `author` TEXT;
ALTER TABLE `sources` ADD COLUMN `color` TEXT;
ALTER TABLE `sources` ADD COLUMN `position` INTEGER NOT NULL DEFAULT 0;
-- The order the sources were listed in until now: by name.
UPDATE `sources` SET `position` = (
  SELECT COUNT(*) FROM `sources` o
  WHERE o.`name` COLLATE NOCASE < `sources`.`name` COLLATE NOCASE
     OR (o.`name` COLLATE NOCASE = `sources`.`name` COLLATE NOCASE AND o.`id` < `sources`.`id`)
);
UPDATE `sources` SET `color` = CASE `position` % 8
  WHEN 0 THEN '#2C47A0' WHEN 1 THEN '#6B4E9B' WHEN 2 THEN '#2F7366' WHEN 3 THEN '#8A5326'
  WHEN 4 THEN '#7A3B55' WHEN 5 THEN '#4A6328' WHEN 6 THEN '#2B6684' ELSE '#7A6420' END;

-- Note blocks get a kind; a question has an open/answered state.
ALTER TABLE `blocks` ADD COLUMN `kind` TEXT NOT NULL DEFAULT 'text'
  CHECK (`kind` IN ('text', 'heading', 'summary', 'quote', 'question'));
ALTER TABLE `blocks` ADD COLUMN `question_state` TEXT CHECK (`question_state` IN ('open', 'answered'));
CREATE INDEX `blocks_question_idx` ON `blocks` (`kind`, `question_state`) WHERE `kind` = 'question';

-- The furthest point a user reached in a video; watched = furthest at 90% of the duration or more.
ALTER TABLE `video_progress` ADD COLUMN `furthest_sec` REAL NOT NULL DEFAULT 0;
UPDATE `video_progress` SET `furthest_sec` = CASE
  WHEN `completed` = 1 THEN COALESCE((SELECT v.`duration_sec` FROM `page_videos` v WHERE v.`id` = `page_video_id`), `last_position_sec`)
  ELSE `last_position_sec` END;

-- A captured frame remembers where it came from: the page video and the second.
ALTER TABLE `block_images` ADD COLUMN `source_video_id` INTEGER REFERENCES `page_videos`(`id`) ON DELETE SET NULL;
ALTER TABLE `block_images` ADD COLUMN `source_sec` REAL;

-- "Keep me signed in" off: the cookie lives until the browser closes (no Max-Age), renewals included.
ALTER TABLE `sessions` ADD COLUMN `persistent` INTEGER NOT NULL DEFAULT 1;
