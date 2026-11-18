import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { fmtDuration, fmtTime, plural } from '../lib/format';
import type { Block, Page, PageVideo, Source } from '../lib/types';
import { Icon } from '../shell/icons';
import { openMenu } from '../shell/menu';
import { SourceAvatar } from '../shell/marks';
import { Link, paths } from '../lib/router';
import { BlockView } from './block-view';
import { nowBlockId } from './block-place';
import { isMine, useNotebook } from './notebook-context';
import { usePlayer } from './player-controller';
import { PageTitle } from './page-title';
import { openDeletePage } from '../source/delete-page-state';

const NO_BLOCKS: Block[] = [];

export type Filter = 'all' | 'mine' | 'question' | 'insight' | 'image' | 'pinned';

const FILTERS: Array<[Filter, string, (b: Block, mine: boolean) => boolean]> = [
  ['all', 'All', () => true],
  ['mine', 'My notes', (_b, mine) => mine],
  ['question', 'Questions', (b) => b.type === 'note' && b.kind === 'question'],
  ['insight', 'Insights', (b) => !!b.isInsight],
  ['image', 'Images', (b) => b.images.length > 0],
  ['pinned', 'Pinned', (b) => !!b.pinned],
];

/** The notebook sheet (design-spec §5.4): header with filters, the blocks, and the line to start writing. */
export function Notebook({ page, source, pages, blocks, videos, selected, editing, editAt, resumeId, annotating, filter, onFilter, slow }: {
  page: Page;
  source: Source;
  pages: Page[];
  blocks: Block[] | undefined;
  videos: PageVideo[];
  selected: number | null;
  editing: number | null;
  editAt: { x: number; y: number } | null;
  resumeId: number | null;
  annotating: number | null;
  filter: Filter;
  onFilter: (filter: Filter) => void;
  slow: boolean;
}) {
  const ctx = useNotebook();
  const player = usePlayer();
  const index = pages.findIndex((p) => p.id === page.id);
  const prev = index > 0 ? pages[index - 1] : null;
  const next = index >= 0 && index < pages.length - 1 ? pages[index + 1] : null;
  const list = blocks ?? NO_BLOCKS;
  const now = useSyncExternalStore(player.state.subscribe, () => {
    const { videoId, t } = player.state.get();
    return nowBlockId(list, videoId, t);
  });
  const counts = useMemo(() => new Map(FILTERS.map(([key, , test]) => [key, list.filter((b) => test(b, isMine(b, ctx.myId, ctx.isOwner))).length])), [list, ctx.isOwner, ctx.myId]);
  const test = FILTERS.find(([key]) => key === filter)![2];
  const shown = filter === 'all' ? list : list.filter((b) => test(b, isMine(b, ctx.myId, ctx.isOwner)));
  const duration = videos.reduce((sum, v) => sum + (v.durationSec ?? 0), 0);

  let content: ReactNode;
  if (!blocks) content = slow ? <Skeleton /> : null;
  else if (!list.length) content = <EmptyNotes hasVideo={videos.length > 0} />;
  else content = shown.map((block) => <BlockView key={block.id} block={block} selected={selected === block.id} editing={editing === block.id}
    editAt={editing === block.id ? editAt : null} now={now === block.id} here={resumeId === block.id} annotating={annotating === block.id} />);

  return <>
    <div className="sheet-head">
      <div className="crumb">
        <Link to={paths.source(source.id)}><SourceAvatar source={source} size="xs" /><span>{source.name}</span></Link>
        {index >= 0 ? <span className="muted">Page {index + 1} of {pages.length}</span> : null}
        <span className="crumb-nav">
          {prev ? <Link to={paths.page(prev.id)} className="ibtn" aria-label="Previous page ([)" title={`Previous: ${prev.title} ([)`}><Icon name="chevl" /></Link>
            : <button type="button" className="ibtn" disabled aria-label="Previous page ([)"><Icon name="chevl" /></button>}
          {next ? <Link to={paths.page(next.id)} className="ibtn" aria-label="Next page (])" title={`Next: ${next.title} (])`}><Icon name="chevr" /></Link>
            : <button type="button" className="ibtn" disabled aria-label="Next page (])"><Icon name="chevr" /></button>}
          {ctx.canWrite ? <button type="button" className="ibtn" aria-label="More for this page" title="More"
            onClick={(e) => openMenu(e.currentTarget, [{ label: 'Delete this page…', icon: 'trash', danger: true, run: () => openDeletePage(page, { leave: true }) }], { alignRight: true })}>
            <Icon name="more" /></button> : null}
        </span>
      </div>
      <PageTitle page={page} />
      <div className="pmeta">
        {videos.length ? <span>{plural(videos.length, 'video')}{duration ? ` · ${fmtDuration(duration)}` : ''}</span> : <span>No video</span>}
        {blocks ? <span>{plural(list.length, 'block')}</span> : null}
        {resumeId && list.some((b) => b.id === resumeId) ? <button type="button" className="linkbtn" onClick={() => ctx.select(resumeId, { scroll: true })}>Jump to where I stopped</button> : null}
      </div>
      {list.length ? <div className="filters" role="toolbar" aria-label="Show blocks">
        {FILTERS.map(([key, label]) => {
          const n = counts.get(key) ?? 0;
          if (key !== 'all' && !n) return null;
          // "My notes" only sorts something out when others wrote on the page too.
          if (key === 'mine' && n === list.length) return null;
          return <button key={key} type="button" className={`fchip${filter === key ? ' is-on' : ''}`} aria-pressed={filter === key} onClick={() => onFilter(key)}>
            {label}{key === 'all' ? '' : <> <span>{n}</span></>}</button>;
        })}
      </div> : null}
    </div>
    <div className="blocks" id="blocks" aria-busy={!blocks} aria-label="Notes">
      {content}
      {filter !== 'all' && blocks ? <p className="filter-note">Showing {shown.length} of {list.length} blocks. <button type="button" className="linkbtn" onClick={() => onFilter('all')}>Show all</button></p> : null}
    </div>
    {blocks && list.length ? <div className="sheet-end">
      <button type="button" className="addline" onClick={() => void ctx.ops.writeAtEnd()}>
        Click to write{videos.length ? <>, or press <kbd>N</kbd> while the video plays</> : null}</button>
    </div> : null}
  </>;
}

function EmptyNotes({ hasVideo }: { hasVideo: boolean }) {
  const ctx = useNotebook();
  const player = usePlayer();
  const t = useSyncExternalStore(player.state.subscribe, () => Math.floor(player.state.get().t));
  if (!ctx.canWrite) {
    return <div className="empty"><h3>No notes here yet</h3>
      <p>Nobody has written notes for this page. Your own notes will appear here, and everyone who opens this source sees them.</p>
      <div className="empty-actions">
        {hasVideo ? <button type="button" className="btn btn-primary" onClick={() => void ctx.ops.noteAt()}><Icon name="note" /> Start a note at {fmtTime(t)}</button> : null}
        <button type="button" className="btn" onClick={() => void ctx.ops.writeAtEnd()}>Write without a timestamp</button>
      </div></div>;
  }
  return <div className="empty">
    <h3>No notes on this page yet</h3>
    {hasVideo ? <p>Play the video and press <kbd>N</kbd> to write a note stamped to that second. <kbd>F</kbd> puts the current frame into your note, <kbd>Q</kbd> quotes the transcript line.</p>
      : <p>Write a note, or add a video to this page to stamp notes to its seconds.</p>}
    <div className="empty-actions">
      {hasVideo ? <button type="button" className="btn btn-primary" onClick={() => void ctx.ops.noteAt()}><Icon name="note" /> Start a note at {fmtTime(t)}</button> : null}
      <button type="button" className={`btn${hasVideo ? '' : ' btn-primary'}`} onClick={() => void ctx.ops.writeAtEnd()}>Write without a timestamp</button>
    </div>
  </div>;
}

function Skeleton() {
  return <>{[92, 70, 84, 60, 76].map((w) => <div key={w} className="blk" aria-hidden="true">
    <div className="b-margin"><span className="sk sk-stamp" /></div>
    <div className="b-main"><span className={`sk sk-w${w}`} /><span className={`sk sk-w${w - 22}`} /></div>
  </div>)}</>;
}

export function useFilterState() {
  return useState<Filter>('all');
}
