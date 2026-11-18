-- Word lookups from the transcript: what a selected word or phrase means in its line, in Vietnamese, as the
-- model answered it. Kept so the same selection in the same line is asked once, for everyone who can see it.
CREATE TABLE `word_lookups` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT,
  -- The selection, folded (lower case, spaces collapsed).
  `term` TEXT NOT NULL,
  -- The transcript line it was selected in, spaces collapsed.
  `line` TEXT NOT NULL,
  -- The answer as JSON (`lookup/word-lookup-types.ts`).
  `result` TEXT NOT NULL,
  `model` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  UNIQUE (`term`, `line`)
);
