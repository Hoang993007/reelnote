import { memo, useEffect, useMemo, useRef, type MouseEvent, type ReactNode } from 'react';
import { splitTags } from '../lib/data';
import { bodyWithImages } from '../lib/markdown';
import { fmtTime } from '../lib/format';
import type { Block } from '../lib/types';
import type { Editor } from '@tiptap/react';
import { BlockEditor, type ActiveEditor, type EditorEvents } from '../editor/block-editor';
import { FigureContext } from '../editor/block-image-node';
import { Icon } from '../shell/icons';
import { BlockBody } from './block-body';
import { insightMenu, moreMenu, searchTag, slashMenu, tagMenu } from './block-menus';
import { canEditBlock, isMine, useNotebook } from './notebook-context';
import { usePlayer } from './player-controller';
import { Annotation } from './annotation';

const PLACEHOLDER: Record<string, string> = {
  text: 'Write, or type / for block types',
  heading: 'Heading',
  summary: 'Summary points, one per line',
  quote: 'Quoted words',
  question: 'Write the question. Add the answer below it when you find it.',
};

/**
 * One notebook block (design-spec §6.3): a margin (stamp, pin, author) and the body, then chips and the private
 * annotation; a floating toolbar when hovered or selected. Only the block being edited mounts an editor.
 */
export const BlockView = memo(function BlockView({ block, selected, editing, editAt, now, here, annotating }: {
  block: Block;
  selected: boolean;
  editing: boolean;
  editAt: { x: number; y: number } | null;
  now: boolean;
  here: boolean;
  annotating: boolean;
}) {
  const ctx = useNotebook();
  const player = usePlayer();
  // own: the viewer wrote it (its private annotation is theirs); mine: they may change it (own, or a writer of the source).
  const own = isMine(block, ctx.myId, ctx.isOwner);
  const mine = canEditBlock(block, ctx);
  const kind = block.kind;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draft = useRef<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const editorOf = useRef<Editor | null>(null);

  const flush = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    if (draft.current !== null) {
      void ctx.ops.update(block.id, { body: draft.current }, `body:${block.id}`);
      draft.current = null;
    }
  };
  // Leaving edit mode (or the page) saves what is still waiting; a block left empty goes.
  const wasEditing = useRef(editing);
  useEffect(() => {
    if (!editing) {
      flush();
      if (wasEditing.current) ctx.ops.dropIfEmpty(block.id);
    }
    wasEditing.current = editing;
    return flush;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const events: EditorEvents = {
    change: (markdown) => {
      draft.current = markdown;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(flush, 600);
    },
    newBlockBelow: () => {
      flush();
      // Keys typed while the new block is being made must not land in this one.
      const active = editorOf.current;
      active?.setEditable(false);
      void ctx.ops.newBlockNextTo(block.id).then((made) => { if (!made) active?.setEditable(true); });
    },
    removeEmpty: () => { flush(); ctx.ops.removeEmpty(block.id); },
    stop: () => {
      flush();
      ctx.edit(null);
      root.current?.focus({ preventScroll: true });
    },
    slash: (anchor) => slashMenu(anchor, block, ctx),
    shortcutKind: (next) => { flush(); void ctx.ops.setKind(block.id, next); },
    togglePlay: () => player.toggle(),
    seekBy: (seconds) => player.seek(player.now() + seconds),
    files: mine ? (files, at) => void ctx.ops.addFiles(block.id, files, at) : null,
  };

  // The editor opens the body with every image of the block in it (the original app bodies may not name them yet); saving stores them in place.
  const editorMarkdown = useMemo(() => bodyWithImages(block.body ?? '', block.images.map((i) => i.id)), [block.body, block.images]);
  const figureHost = useMemo(() => ({ images: new Map(block.images.map((i) => [i.id, i])), open: (id: number) => ctx.openImage(block.id, id) }), [block.images, block.id, ctx]);
  const startEdit = (event: MouseEvent) => {
    if (!mine || editing) return;
    if ((event.target as HTMLElement).closest('a, button, figure, input, select, textarea')) return;
    ctx.select(block.id);
    ctx.edit(block.id, { x: event.clientX, y: event.clientY });
  };

  const text = editing
    ? <FigureContext.Provider value={figureHost}>
        <BlockEditor blockId={block.id} kind={kind} markdown={editorMarkdown} placeholder={PLACEHOLDER[kind]} at={editAt} events={events}
          onReady={(active: ActiveEditor | null) => { editorOf.current = active?.editor ?? null; ctx.setActiveEditor(active); }} />
      </FigureContext.Provider>
    : block.body?.trim() || block.images.length
      ? <BlockBody body={block.body ?? ''} images={block.images} plain={kind === 'heading'} onOpenImage={figureHost.open} />
      : mine ? <span className="b-empty">{PLACEHOLDER[kind]}</span> : null;

  const body = wrapKind(kind, block, text, mine, ctx.author, startEdit, () => ctx.ops.update(block.id, { questionState: block.questionState === 'answered' ? 'open' : 'answered' }));
  const tags = splitTags(block.tags);
  const videoIndex = ctx.videos.findIndex((v) => v.id === block.pageVideoId);
  const stampVideo = videoIndex >= 0 ? ctx.videos[videoIndex] : null;

  return <div ref={root} className={`blk blk-${kind}${selected ? ' is-sel' : ''}${mine ? '' : ' is-ro'}${own && !ctx.isOwner ? ' is-mine' : ''}${editing ? ' is-editing' : ''}`}
    data-id={block.id} tabIndex={-1} aria-label={`${kind === 'text' ? 'Note' : kind}${block.videoTimeSec != null ? ` at ${fmtTime(block.videoTimeSec)}` : ''}`}
    onClick={(e) => { if (!(e.target as HTMLElement).closest('button, a, input, select, textarea, .ProseMirror')) ctx.select(block.id); }}>
    <div className="b-margin">
      {block.videoTimeSec != null && stampVideo ? <button type="button" className={`stamp mono${now ? ' is-now' : ''}`} title={`Play from ${fmtTime(block.videoTimeSec)}`}
        onClick={() => { ctx.select(block.id); ctx.seek(stampVideo.id, block.videoTimeSec!); }}>
        {videoIndex > 0 ? <span className="stamp-v">{stampVideo.title.length > 12 ? `Part ${videoIndex + 1}` : stampVideo.title}</span> : null}{fmtTime(block.videoTimeSec)}
      </button> : null}
      {block.pinned ? <span className="pin-ic" title="Pinned"><Icon name="pin" /></span> : null}
      {own ? (ctx.isOwner ? null : <span className="by by-me">You</span>) : <span className="by">{block.authorName ?? ctx.ownerName}</span>}
    </div>
    <div className="b-main" lang="vi">
      {here ? <span className="here">You stopped here</span> : null}
      {body}
      {block.isInsight || tags.length ? <div className="chips">
        {block.isInsight ? <button type="button" className="chip chip-insight" disabled={!mine} onClick={(e) => insightMenu(e.currentTarget, block, ctx)}>
          <Icon name="star" />Insight{block.insightCategory ? ` · ${block.insightCategory}` : ''}</button> : null}
        {tags.map((tag) => <button key={tag} type="button" className="chip" onClick={() => searchTag(tag)}>#{tag}</button>)}
      </div> : null}
      {own && (block.annotation || annotating) ? <Annotation block={block} focus={annotating} /> : null}
    </div>
    {mine ? <div className="b-tools" role="toolbar" aria-label="Block actions">
      <button type="button" className="tbtn" title="Add a block below (Alt: above)" aria-label="Add a block below"
        onClick={(e) => void ctx.ops.newBlockNextTo(block.id, e.altKey)}><Icon name="plus" /></button>
      <button type="button" className={`tbtn${block.isInsight ? ' is-on' : ''}`} title="Mark as insight (I)" aria-label="Mark as insight" aria-pressed={!!block.isInsight}
        onClick={(e) => insightMenu(e.currentTarget, block, ctx)}><Icon name="star" /></button>
      <button type="button" className={`tbtn${tags.length ? ' is-on' : ''}`} title="Tag (T)" aria-label="Add tag" onClick={(e) => tagMenu(e.currentTarget, block, ctx)}><Icon name="tag" /></button>
      {own ? <button type="button" className={`tbtn${block.annotation ? ' is-on' : ''}`} title="Private annotation (A)" aria-label="Private annotation" onClick={() => ctx.openAnnotation(block.id)}><Icon name="lock" /></button> : null}
      <button type="button" className={`tbtn${block.pinned ? ' is-on' : ''}`} title="Pin (P)" aria-label="Pin" aria-pressed={!!block.pinned}
        onClick={() => void ctx.ops.update(block.id, { pinned: !block.pinned })}><Icon name="pin" /></button>
      <button type="button" className="tbtn" title="More" aria-label="More actions" onClick={(e) => moreMenu(e.currentTarget, block, ctx, player.state.get().videoId ? Math.floor(player.now()) : null)}><Icon name="more" /></button>
    </div> : kind !== 'summary' ? <div className="b-tools" role="toolbar" aria-label="Block actions">
      <button type="button" className="tbtn tbtn-text" title="Write your own note right after this one" onClick={() => void ctx.ops.reply(block.id)}><Icon name="note" />My note here</button>
    </div> : null}
  </div>;
});

function wrapKind(kind: string, block: Block, text: ReactNode, mine: boolean, author: string | null, startEdit: (e: MouseEvent) => void, toggleQuestion: () => void): ReactNode {
  const textBox = (className = 'b-text') => <div className={className} onClick={startEdit}>{text}</div>;
  switch (kind) {
    case 'heading':
      return <h2 className="b-h" onClick={startEdit}>{text}</h2>;
    case 'summary':
      return <div className="summary"><div className="label">Summary</div>{textBox('b-text sum-list')}</div>;
    case 'quote':
      return <blockquote className="b-quote">{textBox()}
        <footer>Transcript{block.videoTimeSec != null ? ` · ${fmtTime(block.videoTimeSec)}` : ''}{author ? ` · ${author}` : ''}</footer></blockquote>;
    case 'question': {
      const answered = block.questionState === 'answered';
      return <div className={`b-q${answered ? ' is-answered' : ''}`}>
        <span className="q-ic"><Icon name="question" /></span>
        {textBox()}
        <button type="button" className="q-state" disabled={!mine} title="Mark open or answered (O)" aria-pressed={answered} onClick={toggleQuestion}>{answered ? 'Answered' : 'Open'}</button>
      </div>;
    }
    default:
      return textBox();
  }
}
