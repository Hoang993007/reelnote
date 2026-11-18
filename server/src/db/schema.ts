import { integer, real, sqliteTable, text, index, primaryKey, unique, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql, type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import type { ImageMarkupShape } from '../lib/image-markup.js';

const uid = () =>
  text('uid')
    .unique()
    .$defaultFn(() => crypto.randomUUID());

const updatedAt = () =>
  text('updated_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString())
    .$onUpdate(() => new Date().toISOString());

const deletedAt = () => text('deleted_at');

// ── Learning ──────────────────────────────────────────────────────────────────

export const SOURCE_KINDS = ['mentor', 'book', 'channel', 'course'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];
/** Monogram colours: each gives at least 4.5:1 with white text. */
export const SOURCE_COLORS = ['#2C47A0', '#6B4E9B', '#2F7366', '#8A5326', '#7A3B55', '#4A6328', '#2B6684', '#7A6420'] as const;
/** A note block's kind. */
export const BLOCK_KINDS = ['text', 'heading', 'summary', 'quote', 'question'] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];
export const QUESTION_STATES = ['open', 'answered'] as const;
export type QuestionState = (typeof QUESTION_STATES)[number];

export const sources = sqliteTable('sources', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  description: text('description'),
  avatarPath: text('avatar_path'),
  /** Library folder (relative to the video library root) the source's videos were imported from. */
  videoFolder: text('video_folder'),
  kind: text('kind', { enum: SOURCE_KINDS }),
  author: text('author'),
  /** Monogram colour, one of SOURCE_COLORS. */
  color: text('color'),
  /** The owner's order of sources (rail, Home). */
  position: integer('position').notNull().default(0),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  uid: uid(),
  updatedAt: updatedAt(),
  deletedAt: deletedAt(),
});

export const sourceInsightCategories = sqliteTable(
  'source_insight_categories',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sourceId: integer('source_id').notNull().references(() => sources.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    position: integer('position').notNull().default(0),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => ({ uniq: unique().on(t.sourceId, t.label) })
);

/** A page of material collected from a source; `position` is the source's explicit page order. */
export const pages = sqliteTable(
  'pages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sourceId: integer('source_id').notNull().references(() => sources.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    videoUrl: text('video_url'),
    date: text('date'),
    position: integer('position').notNull().default(0),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
    uid: uid(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => ({ sourceIdIdx: index('pages_source_id_idx').on(t.sourceId) })
);

/**
 * A local video played on a page, in the page's explicit order. `relPath` is `/`-separated and
 * relative to the video library root; one file belongs to at most one page. Rows are hard-deleted.
 */
export const pageVideos = sqliteTable(
  'page_videos',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    pageId: integer('page_id').notNull().references(() => pages.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
    relPath: text('rel_path').notNull(),
    /** `relPath` lower-cased: Windows names ignore case, so this is the file's identity. */
    relPathKey: text('rel_path_key').notNull(),
    title: text('title').notNull(),
    durationSec: real('duration_sec'),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
    uid: uid(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    relPathKeyUnique: uniqueIndex('page_videos_rel_path_key_unique').on(t.relPathKey),
    pageIdIdx: index('page_videos_page_id_idx').on(t.pageId),
  })
);

export const blocks = sqliteTable(
  'blocks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    pageId: integer('page_id').references(() => pages.id, { onDelete: 'cascade' }),
    sourceId: integer('source_id').references(() => sources.id, { onDelete: 'cascade' }),
    isInsight: integer('is_insight').notNull().default(0),
    insightCategory: text('insight_category'),
    type: text('type', { enum: ['note'] }).notNull(),
    position: integer('position').notNull().default(0),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
    tags: text('tags'),
    pinned: integer('pinned').notNull().default(0),
    color: text('color'),
    annotation: text('annotation'),
    imageLayout: text('image_layout', { enum: ['wrap', 'row'] }).notNull().default('wrap'),
    /** Stamp of a page block: the video it was written against and the second in it. */
    pageVideoId: integer('page_video_id').references(() => pageVideos.id, { onDelete: 'set null' }),
    videoTimeSec: real('video_time_sec'),
    uid: uid(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
    /** Who wrote it. NULL (rows from before accounts) means the owner. See access/visibility.ts. */
    authorId: integer('author_id').references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: BLOCK_KINDS }).notNull().default('text'),
    /** Set on a question: open until answered. */
    questionState: text('question_state', { enum: QUESTION_STATES }),
  },
  (t) => ({
    pageIdIdx: index('blocks_page_id_idx').on(t.pageId),
    sourceIdIdx: index('blocks_source_id_idx').on(t.sourceId),
    pageVideoIdIdx: index('blocks_page_video_id_idx').on(t.pageVideoId),
    authorIdIdx: index('blocks_author_id_idx').on(t.authorId),
  })
);

/** Reading state per page and user: resume point and last visit. Video playback is in `video_progress`. */
export const pageReadingState = sqliteTable(
  'page_reading_state',
  {
    pageId: integer('page_id').notNull().references(() => pages.id, { onDelete: 'cascade' }),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    lastBlockId: integer('last_block_id').references(() => blocks.id, { onDelete: 'set null' }),
    lastViewedAt: text('last_viewed_at').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.pageId, t.userId] }),
    userViewedIdx: index('page_reading_state_user_viewed_idx').on(t.userId, t.lastViewedAt),
  })
);

/** A user's playback of a page video. */
export const videoProgress = sqliteTable(
  'video_progress',
  {
    pageVideoId: integer('page_video_id').notNull().references(() => pageVideos.id, { onDelete: 'cascade' }),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    lastPositionSec: real('last_position_sec').notNull().default(0),
    /** Sticky: once watched past the threshold it stays watched. */
    completed: integer('completed').notNull().default(0),
    lastWatchedAt: text('last_watched_at'),
    /** Client clock (ms) of the last accepted playback write; older writes are ignored. */
    playbackClientTs: integer('playback_client_ts').notNull().default(0),
    /** The furthest second reached; watched once it is at 90% of the duration. */
    furthestSec: real('furthest_sec').notNull().default(0),
  },
  (t) => ({ pk: primaryKey({ columns: [t.pageVideoId, t.userId] }) })
);

/** The friends a source is shared with. The owner reads every source. */
export const sourceShares = sqliteTable(
  'source_shares',
  {
    sourceId: integer('source_id').notNull().references(() => sources.id, { onDelete: 'cascade' }),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
    /** 1: the friend may change the source (details, pages, videos, notes), not only open it. */
    canWrite: integer('can_write').notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.sourceId, t.userId] }),
    userIdIdx: index('source_shares_user_id_idx').on(t.userId),
  })
);

export const blockText = sqliteTable('block_text', {
  blockId: integer('block_id').primaryKey().references(() => blocks.id, { onDelete: 'cascade' }),
  body: text('body'),
});

export const blockImages = sqliteTable(
  'block_images',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    blockId: integer('block_id').notNull().references(() => blocks.id, { onDelete: 'cascade' }),
    filePath: text('file_path').notNull(),
    position: integer('position').notNull().default(0),
    caption: text('caption'),
    displaySize: text('display_size').notNull().default('full'),
    displayWidth: integer('display_width'),
    cropX: real('crop_x'),
    cropY: real('crop_y'),
    cropW: real('crop_w'),
    cropH: real('crop_h'),
    markup: text('markup', { mode: 'json' }).$type<ImageMarkupShape[]>(),
    /** A captured frame: the page video and second it came from. */
    sourceVideoId: integer('source_video_id').references(() => pageVideos.id, { onDelete: 'set null' }),
    sourceSec: real('source_sec'),
  },
  (t) => ({
    blockIdIdx: index('block_images_block_id_idx').on(t.blockId),
    filePathIdx: index('block_images_file_path_idx').on(t.filePath),
  })
);

// ── Infrastructure ────────────────────────────────────────────────────────────

export const managedFiles = sqliteTable('managed_files', {
  id:        integer('id').primaryKey({ autoIncrement: true }),
  filePath:  text('file_path').notNull().unique(),
  source:    text('source').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

// ── Row types ─────────────────────────────────────────────────────────────────

export type Source = InferSelectModel<typeof sources>;
export type NewSource = InferInsertModel<typeof sources>;
export type SourceInsightCategory = InferSelectModel<typeof sourceInsightCategories>;
export type NewSourceInsightCategory = InferInsertModel<typeof sourceInsightCategories>;
export type Page = InferSelectModel<typeof pages>;
export type NewPage = InferInsertModel<typeof pages>;
export type PageVideo = InferSelectModel<typeof pageVideos>;
export type NewPageVideo = InferInsertModel<typeof pageVideos>;
export type Block = InferSelectModel<typeof blocks>;
export type NewBlock = InferInsertModel<typeof blocks>;
export type BlockText = InferSelectModel<typeof blockText>;
export type BlockImage = InferSelectModel<typeof blockImages>;

// ── Accounts ──────────────────────────────────────────────────────────────────

export const USER_ROLES = ['owner', 'friend'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  /** Stored lower-cased and trimmed: the sign-in identity. */
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  /** `scrypt$N$r$p$salt$hash` (base64), see auth/password.ts. */
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: USER_ROLES }).notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  disabledAt: text('disabled_at'),
});

/** A signed-in browser. `id` is the SHA-256 (hex) of the cookie token; the token is never stored. */
export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
    /** 0: "keep me signed in" was off, so the cookie has no expiry and ends with the browser. */
    persistent: integer('persistent').notNull().default(1),
  },
  (t) => ({
    userIdIdx: index('sessions_user_id_idx').on(t.userId),
    expiresAtIdx: index('sessions_expires_at_idx').on(t.expiresAt),
  })
);

export type User = InferSelectModel<typeof users>;
export type Session = InferSelectModel<typeof sessions>;
