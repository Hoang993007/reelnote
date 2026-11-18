# Architecture

## Process

One Node process (`server/src/start.ts`): applies pending migrations, builds the Fastify app
(`app.ts`) and listens on `REELNOTE_HOST:REELNOTE_PORT`. The API is under `/api`; stored images are
under `/images/learning/<uuid>.<ext>`. The web UI's build (`web/dist`) is served from the same
port, so each address the app is reached at is one origin; any other GET for an HTML page gets
`index.html`, so the UI's routes survive a reload.

Config: `server/src/config.ts` reads the environment once and refuses a data dir inside the repo.

## Server layout (`server/src`)

| Folder | What |
|---|---|
| `db/` | better-sqlite3 + drizzle client (`client.ts`), schema, migrations and their runner |
| `lib/` | Errors and the HTTP error boundary, image storage, file streaming (Range), path containment, logger, worker start |
| `settings/` | Key/value settings (`video_library_root`) |
| `auth/` | Accounts, sessions, the auth hook, `/api/auth/*` |
| `access/` | Who can see and change what: SQL visibility scopes, route guards, source shares |
| `admin/` | The owner's `/api/admin/*`: friend accounts, source shares |
| `learning/` | Sources, pages, blocks, images, insights, reading state, search, page videos (library browse, import, stream, progress, transcript) |
| `lookup/` | Word lookup: what a transcript selection means in its line, asked of Gemini, stored, rate limited |
| `cli/` | `pnpm cli <command>`: migrate, backup, and the account, sharing and notes commands |

`learning/` started as the learning module of an earlier desktop app of mine and was split out into this
web app; file responses here carry `Cross-Origin-Resource-Policy: same-origin`.

## Data

`<REELNOTE_DATA_DIR>/reelnote.db` (WAL), `images/learning/` (block images, source avatars, named
`<uuid>.<ext>` and registered in `managed_files`). The schema starts from the original app's tables
(`0001_init.sql`), so its data could be copied over column for column.

The SQL functions `unicode_lower` and `strip_markdown_images` are registered on every connection:
search needs both.

## Users and access

One owner account (created from the CLI) and any number of friend accounts.

- The owner reads and writes every source, page, video, insight category and the video library,
  and alone creates, orders and deletes sources, sets the library folder and manages accounts.
- A friend opens (reads) the sources with a `source_shares` row for them. `can_write = 1` (migration
  `0005_write_access.sql`) also lets them change that source: its details, pages, videos, insight
  categories, imports from the library (which they may then browse) and every note on it.
  Elsewhere a friend writes only their own blocks (with their images), reading state and progress.
- New friends open every source, and a new source opens to every friend (read only), until the
  owner unticks it on People and access. Source summaries carry the viewer's `canWrite`.
- Blocks carry `author_id` (NULL, from before accounts, is the owner's) and come with `authorName`.
  Everyone who opens a source sees every note on it; the private annotation stays its author's, and
  a writer changing someone else's block cannot set it.
- `page_reading_state` and `video_progress` are keyed by user; a video's duration stays on
  `page_videos`, shared.
- Routes call the guards in `access/guards.ts` before the service (404 for what the viewer cannot
  see, 403 for what they see but may not change); list queries use the SQL scopes in
  `access/visibility.ts`. `access/__tests__/access-matrix.test.ts` drives every rule through the app.

The plan had `sources.owner_id`; with exactly one owner per instance it would always hold the same
id, so ownership is the owner role instead.

## What the web UI added (migration `0004_study_desk.sql`)

- Sources: `kind` (mentor, book, channel, course), `author`, `color` (one of eight monogram colours,
  each 4.5:1 with white text), `position` (the owner's order; the rail and Home follow it).
  `PUT /api/sources/order` (owner) takes every source id once. Source summaries carry the viewer's
  `watchedPageCount`, `openQuestionCount` and `lastPageId` (the page they opened last there, Alt 1–9).
- Blocks: `kind` (text, heading, summary, quote, question; `type` is always 'note') and
  `question_state` (open, answered). Open-question lists: `GET /api/sources/:id/questions?state=` and
  `GET /api/learning/questions?state=&limit=`, the viewer's own blocks plus the owner's.
- Placing blocks: a new page block takes `afterBlockId` or `beforeBlockId` (the original app's `insertAfterBlockId`
  still works); `PUT /api/blocks/:id/position` moves one of the viewer's blocks next to any block they
  see. `PUT /api/blocks/:id` can re-stamp a block (`stamp`, a video of its own page) and change its kind.
  A note may be created empty (the UI makes the block, then the text is typed into it).
- Video progress: `video_progress.furthest_sec` only grows; a video is watched (`completed`, sticky)
  once the furthest point reaches 90% of the duration. Page lists, sources and Continue carry the
  viewer's `watchState` (full, half, none) from it (`learning/services/watch-state-sql.ts`).
- Frame capture: `block_images.source_video_id` and `source_sec` record where a frame came from
  (`imageSourceVideoId`/`imageSourceSec` on block creation, `sourceVideoId`/`sourceSec` on
  `POST /api/blocks/:id/images`); the video must be on the block's own page.
- Search (`GET /api/learning/search`) returns groups (sources, pages, notes, private annotations, tags),
  each with its items (`limit` per group) and total. Matching folds case and accents (`fold_text`, NFD,
  marks stripped, đ→d, `lib/fold-text.ts`), registered next to `unicode_lower`. A query starting with `#`
  searches tags only. Private annotations match only for their author.
- Continue takes `limit` (up to 20) for Recent pages.
- Image markup colours add orange and blue (the UI's three are orange, blue, white).
- Sessions: `persistent` = 0 when "Keep me signed in" was off at sign-in (`remember: false`): the cookie
  has no Max-Age, renewals included.
- People: `GET /api/admin/users` adds `lastSeenAt` and a friend's `sourceIds`;
  `PUT /api/admin/users/:id/sources` replaces a friend's sources; `GET /api/admin/addresses` lists the
  LAN addresses (when listening beyond loopback) and `REELNOTE_TAILSCALE_URL`.
- Folder import (`POST /api/sources/:id/video-import`) takes an optional `files` list (relPath and
  title) to import only the ticked files under edited titles.

## Transcript worker

The transcript is a subtitle track read from the mp4 in a worker thread (`learning/services/video-transcript-*`):
the English `tx3g` track, else the Vietnamese one (`mp4-transcript-track.ts`), since the video-translator pipeline
subtitles English and Vietnamese videos in their own language and dubs the rest into English.
The same read returns `sourceUrl`, the link the file was downloaded from: the `©cmt` comment tag
(`moov/udta/meta/ilst`, `mp4-source-url.ts`), where yt-dlp's `--embed-metadata` and the video-translator
pipeline put it; `null` when the tag holds no http(s) link. The player shows it as a link button, next to the
picture's resolution (read from the `<video>` element, nothing stored).
From source the worker registers tsx; the build bundles it to `dist/workers/` (`scripts/build.mjs`).

## Word lookup (migration `0006_word_lookups.sql`)

Selecting a word, a phrase or a sentence (up to 60 words, 600 characters) within up to 4 consecutive transcript lines
offers Look up; a sentence is translated and its key words explained. `lineEnd` names the last line of a
selection that runs on; the lines are joined with spaces and used as one line.
`POST /api/page-videos/:id/word-lookup` takes `{ line, lineEnd?, text }`: the guard checks the viewer can read the video,
the server reads the line from the video's own transcript and refuses a selection that is not in it
(`lookup-not-in-line`), so only transcript text the viewer can see is ever sent out. The answer (Vietnamese:
meaning in this line, why, lemma, IPA, part of speech, up to three other meanings, the line translated) comes
from `word_lookups` when the same selection was asked in the same line before, by anyone; else from Gemini
(`lookup/gemini-client.ts`, `generateContent` with JSON output, model `REELNOTE_GEMINI_MODEL`, default
`gemini-3.5-flash-lite`), and is stored. Model calls are capped in memory: 30 per user per 10 minutes, 300 per
user per day, 8 a minute in all (`lookup-limit`, 429, with `retryAfterSec`); the provider's own quota answers
`lookup-limit` too. The web card is `page/word-lookup.tsx`; Save to notes keeps it as a text block stamped at
the line's time (`page/notebook-save-note.ts`).

Follow-up chat: the card's Ask more opens a panel at the right edge (`page/word-chat.tsx`).
`POST /api/page-videos/:id/word-chat` takes `{ line, lineEnd?, text, turns }` (turns alternate user/model, start and end with
the user, at most 19, each up to 4000 characters) and answers `{ reply }` (Markdown, Vietnamese, rendered sanitized).
Gemini gets the lines, the stored first answer (looked up now if missing) as its earlier turn, then the turns
(`lookup/gemini-chat.ts`). Each reply is one model call under the same caps and keys as a lookup; nothing of the
chat is stored on the server, and closing the panel forgets it. Each answer can be saved to notes.

Keys (migration `0007_lookup_keys.sql`, `lookup/lookup-key-service.ts`): a lookup uses the user's own Gemini API
key (`users.gemini_api_key`), else the shared key the owner set (`settings.gemini_api_key_shared`), else
`REELNOTE_GEMINI_API_KEY`; none: `lookup-off` (503). A key Google refuses: `lookup-key-refused` (400). On an own
key only a loose cap applies (100 per 10 minutes); the per-user and overall caps above are for the shared key.
`GET /api/lookup-keys` (status: the last four characters of the user's key, and whether a shared key is set,
its last four for the owner only), `PUT /api/lookup-keys/own` and `PUT /api/lookup-keys/shared` (owner)
take `{ key }`, `null` or empty to remove. The UI is the account menu's Word lookup key dialog
(`auth/lookup-keys.tsx`), with a step-by-step guide to getting a free key in Google AI Studio.

## Web UI (`web/`)

Vite, React 18, TypeScript; Tiptap 3.23 (`@tiptap/markdown`) for the notebook, the version the original app uses
(pnpm overrides pin every `@tiptap/*` package to it). Fonts (Be Vietnam Pro for text, IBM Plex Mono for times) are
bundled. The design (kept private) set the look; the stylesheets start from the
approved prototype's (`web/src/styles/tokens.css`, `app.css`), plus `additions.css` and
`notebook.css`.

| Folder | What |
|---|---|
| `lib/` | API client (`api.ts`), the save queue (`saves.ts`), cached reads (`resource.ts`, `data.ts`), router, keyboard model (`keys.ts`), markdown, folding, formats |
| `shell/` | Top bar, rail, status bar, toasts, menus, dialogs, keyboard sheet, global keys |
| `auth/` | Sign-in, change password |
| `home/`, `source/`, `people/`, `search/` | The screens and the Ctrl K palette |
| `page/` | The study desk: player, transcript, notebook, blocks, the notebook's operations (`notebook-ops.ts`) |
| `editor/` | The block editor (Tiptap with the original app's markdown extensions and block image node) |
| `images/` | Figures (crop and markup drawn over the stored original) and the image viewer |
| `library/` | Browsing the video library (import a folder, locate or add a video) |

- **Routes:** `/`, `/login?next=`, `/s/:id`, `/s/:id/insights`, `/s/:id/questions`,
  `/p/:id?b=&t=&v=`, `/people`.
- **Reads** are cached by key (`lib/data.ts`) and shared by every screen; a page's blocks live in
  that cache in page order, and the notebook changes them in place (`page/notebook-ops.ts`).
- **Writes** go through `lib/saves.ts`: edits queue in order (a block's text coalesces, saved 600 ms
  after typing stops), wait in localStorage while the server cannot be reached (the offline banner),
  and replay when it is back. Creates and uploads are sent at once and fail with a message.
- **Editing:** only the block being edited mounts an editor; the others render sanitized markdown
  (marked + DOMPurify) with figures between the text. Bodies stay markdown with images as
  `![](block-image:ID)`.
- **Frame capture** draws the `<video>` frame to a canvas and uploads the PNG with its source video
  and second; no clipboard, so it works over plain HTTP.
- **Deletes** wait 6 s for Undo before they are sent.
- **Keyboard:** single-letter keys match `event.code` and fire only outside text fields (Vietnamese
  IMEs never change them); screens register handlers (`lib/keys.ts`), newest first.
- **Per person, in this browser:** theme, study pane width (`localStorage`). Reading position, video
  progress and Continue are on the server, per user.
- **PWA:** `web/static/manifest.webmanifest` and icons; no service worker.
