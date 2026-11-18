import { useState, type DragEvent, type KeyboardEvent } from 'react';
import { keys } from '../lib/data';
import { fmtDuration, pad2, plural } from '../lib/format';
import { invalidate, mutate } from '../lib/resource';
import { Link, paths } from '../lib/router';
import { failureText, save } from '../lib/saves';
import { useSession } from '../lib/session';
import { flashNotice, toast } from '../lib/shell-state';
import type { Page, Source } from '../lib/types';
import { Icon } from '../shell/icons';
import { openMenu } from '../shell/menu';
import { ProgressMark, WATCH_LABEL } from '../shell/marks';
import { openDeletePage } from './delete-page-state';

/** The ordered page list; its writers reorder by dragging (drop line) or Alt ↑ ↓ on a focused row. */
export function PagesTab({ source, pages, onImport, onNewPage }: { source: Source; pages: Page[] | undefined; onImport: () => void; onNewPage: () => void }) {
  const { ownerName } = useSession();
  const canWrite = source.canWrite;
  const [drag, setDrag] = useState<{ id: number; over: number | null; after: boolean } | null>(null);
  if (!pages) return null;
  if (!pages.length) {
    return <div className="empty"><h3>No pages yet</h3>
      {canWrite ? <><p>Import a folder of videos to get one page per video, or add a page by hand.</p>
        <div className="empty-actions"><button type="button" className="btn btn-primary" onClick={onImport}><Icon name="folder" /> Import a folder</button>
          <button type="button" className="btn" onClick={onNewPage}>New page</button></div></>
        : <p>No pages in this source yet.</p>}
    </div>;
  }

  const reorder = (ids: number[], movedId: number) => {
    const byId = new Map(pages.map((p) => [p.id, p]));
    mutate<Page[]>(keys.pages(source.id), () => ids.map((id, position) => ({ ...byId.get(id)!, position })));
    save('PATCH', `/sources/${source.id}/pages/reorder`, { positions: ids.map((id, position) => ({ id, position })) }, `order:${source.id}`)
      .catch((error: unknown) => { toast(failureText(error, ownerName)); invalidate(keys.pages(source.id)); });
    flashNotice(`Moved to position ${ids.indexOf(movedId) + 1}`);
  };

  const moveBy = (event: KeyboardEvent, page: Page) => {
    if (!canWrite || !event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    event.stopPropagation();
    const ids = pages.map((p) => p.id);
    const from = ids.indexOf(page.id);
    const to = from + (event.key === 'ArrowUp' ? -1 : 1);
    if (to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    reorder(ids, page.id);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`.prow[data-p="${page.id}"] .prow-t`)?.focus());
  };

  const over = (event: DragEvent, page: Page) => {
    if (!drag) return;
    event.preventDefault();
    const box = event.currentTarget.getBoundingClientRect();
    setDrag({ ...drag, over: page.id, after: event.clientY > box.top + box.height / 2 });
  };
  const drop = (event: DragEvent) => {
    event.preventDefault();
    if (!drag || drag.over === null || drag.over === drag.id) { setDrag(null); return; }
    const ids = pages.map((p) => p.id).filter((id) => id !== drag.id);
    ids.splice(ids.indexOf(drag.over) + (drag.after ? 1 : 0), 0, drag.id);
    reorder(ids, drag.id);
    setDrag(null);
  };

  return <ol className="plist" aria-label="Pages in order">
    {pages.map((page, i) => <li key={page.id} data-p={page.id} draggable={canWrite}
      className={`prow${drag?.id === page.id ? ' is-drag' : ''}${drag?.over === page.id ? (drag.after ? ' drop-after' : ' drop-before') : ''}`}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(page.id)); setDrag({ id: page.id, over: null, after: false }); }}
      onDragOver={(e) => over(e, page)} onDrop={drop} onDragEnd={() => setDrag(null)}>
      {canWrite ? <span className="grip" title="Drag, or Alt ↑ ↓ to move" aria-hidden="true"><Icon name="grip" /></span> : <span />}
      <span className="mono prow-n">{pad2(i + 1)}</span>
      <Link to={paths.page(page.id)} className="prow-t" onKeyDown={(e) => moveBy(e, page)}
        aria-keyshortcuts={canWrite ? 'Alt+ArrowUp Alt+ArrowDown' : undefined}>{page.title}</Link>
      <span className="prow-m">{page.videoCount > 1 ? `${page.videoCount} videos · ` : ''}{page.videoCount ? fmtDuration(page.durationSec) || 'Video' : 'No video'}</span>
      <span className="prow-m">{page.blockCount ? plural(page.blockCount, 'note') : <span className="muted">No notes</span>}</span>
      <span className="prow-s">{page.videoCount ? <><ProgressMark state={page.watchState} /><span>{WATCH_LABEL[page.watchState]}</span></> : null}</span>
      {canWrite ? <button type="button" className="ibtn prow-more" aria-label={`More for ${page.title}`} title="More"
        onClick={(e) => openMenu(e.currentTarget, [{ label: 'Delete page…', icon: 'trash', danger: true, run: () => openDeletePage(page) }], { alignRight: true })}>
        <Icon name="more" /></button> : <span />}
    </li>)}
  </ol>;
}
