import { createContext, useContext } from 'react';
import type { Block, InsightCategory, PageVideo } from '../lib/types';
import type { ActiveEditor } from '../editor/block-editor';
import type { NotebookOps } from './notebook-ops';

/** What every block needs from its notebook; stable across playback ticks so blocks stay memoized. */
export type NotebookCtx = {
  ops: NotebookOps;
  pageId: number;
  sourceId: number;
  myId: number;
  isOwner: boolean;
  /** The viewer may change the page's source: its pages, videos and everyone's notes. */
  canWrite: boolean;
  ownerName: string;
  /** The source's author: a quote's speaker. */
  author: string | null;
  videos: PageVideo[];
  categories: InsightCategory[];
  /** Tags used on this page, for the tag menu. */
  tags: string[];
  select: (id: number | null, opts?: { scroll?: boolean }) => void;
  edit: (id: number | null, at?: { x: number; y: number } | null) => void;
  openImage: (blockId: number, imageId: number) => void;
  seek: (videoId: number, t: number) => void;
  setActiveEditor: (active: ActiveEditor | null) => void;
  /** Opens the private annotation of a block for typing (A). */
  openAnnotation: (id: number) => void;
};

export const NotebookContext = createContext<NotebookCtx | null>(null);

export function useNotebook(): NotebookCtx {
  const ctx = useContext(NotebookContext);
  if (!ctx) throw new Error('useNotebook outside a notebook');
  return ctx;
}

/** The viewer wrote it (blocks from before accounts, author null, are the owner's). */
export const isMine = (block: Pick<Block, 'authorId'>, myId: number, isOwner: boolean) => block.authorId === myId || (block.authorId === null && isOwner);

/** The viewer may change the block: they wrote it, or they may change its source. */
export const canEditBlock = (block: Pick<Block, 'authorId'>, ctx: Pick<NotebookCtx, 'myId' | 'isOwner' | 'canWrite'>) =>
  ctx.canWrite || isMine(block, ctx.myId, ctx.isOwner);
