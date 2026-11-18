/** The API's shapes, as the server sends them (server/src/learning, auth, admin). */

export type Role = 'owner' | 'friend';
export type User = { id: number; email: string; displayName: string; role: Role; createdAt: string; disabled: boolean };
export type Me = { user: User; ownerName: string | null };

export type SourceKind = 'mentor' | 'book' | 'channel' | 'course';
export type WatchState = 'full' | 'half' | 'none';

export type Source = {
  id: number;
  name: string;
  description: string | null;
  avatarPath: string | null;
  kind: SourceKind | null;
  author: string | null;
  color: string | null;
  position: number;
  /** The library folder its videos were imported from (prefills Import). */
  videoFolder: string | null;
  createdAt: string;
  pageCount: number;
  watchedPageCount: number;
  insightCount: number;
  openQuestionCount: number;
  lastPageId: number | null;
  /** The viewer may change it: details, pages, videos and every note on it. */
  canWrite: boolean;
};

export type Page = {
  id: number;
  sourceId: number;
  title: string;
  date: string | null;
  position: number;
  createdAt: string;
  blockCount: number;
  lastBlockId: number | null;
  lastViewedAt: string | null;
  videoCount: number;
  durationSec: number | null;
  watchState: WatchState;
};

export type PageVideo = {
  id: number;
  pageId: number;
  position: number;
  relPath: string;
  title: string;
  durationSec: number | null;
  lastPositionSec: number;
  furthestSec: number;
  completed: boolean;
  lastWatchedAt: string | null;
  revision: string | null;
};
export type PageVideoList = { libraryRootSet: boolean; videos: PageVideo[] };

export type MarkupColor = 'orange' | 'blue' | 'white' | 'red' | 'yellow' | 'green' | 'cyan';
export type MarkupShape = { kind: 'rect' | 'line'; color: MarkupColor; x1: number; y1: number; x2: number; y2: number };

export type BlockImage = {
  id: number;
  filePath: string;
  position: number;
  caption: string | null;
  displayWidth: number | null;
  cropX: number | null;
  cropY: number | null;
  cropW: number | null;
  cropH: number | null;
  markup: MarkupShape[] | null;
  sourceVideoId: number | null;
  sourceSec: number | null;
};

export type BlockKind = 'text' | 'heading' | 'summary' | 'quote' | 'question';
export type QuestionState = 'open' | 'answered';

export type Block = {
  id: number;
  pageId: number | null;
  pageTitle: string | null;
  sourceId: number | null;
  isInsight: number;
  insightCategory: string | null;
  type: 'note';
  kind: BlockKind;
  questionState: QuestionState | null;
  position: number;
  createdAt: string;
  body: string | null;
  tags: string | null;
  pinned: number;
  annotation: string | null;
  pageVideoId: number | null;
  videoTimeSec: number | null;
  authorId: number | null;
  /** The author's name (the owner's for blocks from before accounts). */
  authorName: string | null;
  images: BlockImage[];
};

export type InsightCategory = { id: number; sourceId: number; label: string; position: number };
export type Insights = { pageBlocks: Block[]; standaloneBlocks: Block[] };

export type ContinuePage = {
  pageId: number;
  pageTitle: string;
  sourceId: number;
  sourceName: string;
  sourceColor: string | null;
  lastBlockId: number | null;
  lastViewedAt: string;
  blockCount: number;
  watchState: WatchState;
};

export type QuestionItem = {
  blockId: number;
  pageId: number;
  pageTitle: string;
  sourceId: number;
  sourceName: string;
  sourceColor: string | null;
  body: string | null;
  questionState: QuestionState;
  pageVideoId: number | null;
  videoTimeSec: number | null;
  authorId: number | null;
};
export type Listed<T> = { items: T[]; total: number };

export type SourceHit = { sourceId: number; name: string; kind: SourceKind | null; author: string | null; color: string | null };
export type PageHit = { pageId: number; pageTitle: string; sourceId: number; sourceName: string; sourceColor: string | null };
export type BlockHit = {
  blockId: number;
  pageId: number | null;
  pageTitle: string | null;
  sourceId: number;
  sourceName: string;
  sourceColor: string | null;
  type: 'note';
  kind: BlockKind;
  pageVideoId: number | null;
  videoTimeSec: number | null;
  snippet: string;
};
export type TagHit = { tag: string; count: number };
export type SearchResult = {
  sources: Listed<SourceHit>;
  pages: Listed<PageHit>;
  notes: Listed<BlockHit>;
  annotations: Listed<BlockHit>;
  tags: Listed<TagHit>;
};

export type TranscriptCue = { startSec: number; endSec: number; text: string };
/** `sourceUrl`: the link the video file was downloaded from (its comment tag), when it holds one. */
export type Transcript = { cues: TranscriptCue[]; reason: null | 'no-transcript-track'; sourceUrl: string | null };

export type LibraryFile = {
  name: string;
  relPath: string;
  sizeBytes: number;
  parsed: { title: string; date: string | null };
  attachedTo: { pageId: number; pageTitle: string; sourceId: number; sourceName: string } | null;
};
export type LibraryListing = { root: string; dir: string; parent: string | null; folders: Array<{ name: string; relPath: string }>; files: LibraryFile[] };

/** `sourceIds`: what a friend opens; `writeSourceIds` (a subset): what they may also change. */
export type Person = User & { lastSeenAt: string | null; sourceIds: number[]; writeSourceIds: number[] };
export type Addresses = { port: number; host: string; lan: string[]; tailscale: string | null };
