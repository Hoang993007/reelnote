import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, isNotFound } from '../lib/api';
import { keys, splitTags, useBlocks, useCategories, usePage, usePages, useSource, useVideos } from '../lib/data';
import { plainText } from '../lib/markdown';
import { pageUi, setPagesOpen } from '../lib/page-ui';
import { Icon } from '../shell/icons';
import { invalidate, useDelayed } from '../lib/resource';
import { navigate, paths, useLocation, type Route } from '../lib/router';
import { useSession } from '../lib/session';
import { hints, readPref, toast, writePref } from '../lib/shell-state';
import { useStore } from '../lib/store';
import type { ActiveEditor } from '../editor/block-editor';
import { ImageViewer } from '../images/image-viewer';
import { LibraryPicker } from './library-picker';
import { NotebookContext, canEditBlock, type NotebookCtx } from'./notebook-context';
import { useNotebookOps } from './notebook-ops';
import { Notebook, type Filter } from './notebook';
import { PageList } from './page-list';
import { PlayerContext, PlayerController } from './player-controller';
import { StudyPane } from './study-pane';
import type { QuoteSource } from './transcript';
import { usePageKeys } from './page-keys';
import { useLanding, useReadingPosition } from './use-page-landing';
import { Splitter } from './splitter';

type PageRoute = Extract<Route, { name: 'page' }>;

/** The study desk (design-spec §5.4): page list, study pane (video, transcript) and the notebook sheet. */
export function PageView({ route }: { route: PageRoute }) {
  const session = useSession();
  const { me, isOwner, ownerName } = session;
  const { visit } = useLocation();
  const page = usePage(route.id);
  const source = useSource(page.data?.sourceId ?? null);
  const pages = usePages(page.data?.sourceId ?? null);
  const videoList = useVideos(route.id);
  const blocks = useBlocks(route.id);
  const categories = useCategories(page.data?.sourceId ?? null);
  const { pagesOpen, focus } = useStore(pageUi);
  const player = useMemo(() => new PlayerController(), []);
  const videos = useMemo(() => videoList.data?.videos ?? [], [videoList.data]);

  const [videoId, setVideoId] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [editing, setEditing] = useState<{ id: number; at: { x: number; y: number } | null } | null>(null);
  const [annotating, setAnnotating] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [viewer, setViewer] = useState<{ blockId: number; imageId: number } | null>(null);
  const [picker, setPicker] = useState<'locate' | 'add' | null>(null);
  const [resumeId, setResumeId] = useState<number | null>(null);
  const [studyWidth, setStudyWidth] = useState(() => readPref(me.id, 'studyWidth', 44));
  const [typing, setTyping] = useState(false);
  const sheet = useRef<HTMLElement>(null);
  const activeEditor = useRef<ActiveEditor | null>(null);
  const quoteRef = useRef<() => QuoteSource | null>(() => null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  // Gone (unshared, deleted): back Home with a word.
  useEffect(() => {
    if (isNotFound(page.error)) {
      toast('You no longer have access to that page, or it was deleted.');
      invalidate(keys.sources);
      navigate(paths.home(), { replace: true });
    }
  }, [page.error]);

  // The visit counts (Recent pages, Continue, Alt 1–9). Leaving, the lists that show progress load again.
  useEffect(() => {
    void api(`/pages/${route.id}/reading-state`, { method: 'PUT', body: {} }).then(() => invalidate(keys.recent, keys.sources)).catch(() => undefined);
    return () => invalidate('pages:', keys.recent, keys.sources);
  }, [route.id]);

  const flash = useCallback((id: number) => {
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`.blk[data-id="${id}"]`);
      if (!el) return;
      el.classList.remove('flash');
      void el.offsetWidth;
      el.classList.add('flash');
    });
  }, []);

  const select = useCallback((id: number | null, opts: { scroll?: boolean } = {}) => {
    setSelected(id);
    setEditing((current) => (current && current.id !== id ? null : current));
    if (id !== null && opts.scroll) {
      requestAnimationFrame(() => document.querySelector(`.blk[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    }
  }, []);

  const edit = useCallback((id: number | null, at: { x: number; y: number } | null = null) => {
    setEditing(id === null ? null : { id, at });
    if (id !== null) {
      setSelected(id);
      setFilter('all');
    }
  }, []);

  const selectVideo = useCallback((id: number, at: number | null = null, play = false) => {
    player.pendingSeek = at === null ? null : { t: at, play };
    setVideoId(id);
  }, [player]);
  player.onSelect = selectVideo;

  // First video: from the link, else the first not yet watched (design-spec §5.4, Resume).
  const routeBlock = route.block;
  useEffect(() => {
    if (!videos.length || (videoId && videos.some((v) => v.id === videoId))) return;
    const fromBlock = routeBlock ? blocks.data?.find((b) => b.id === routeBlock)?.pageVideoId : null;
    const wanted = videos.find((v) => v.id === (route.v ?? fromBlock)) ?? videos.find((v) => !v.completed) ?? videos[0];
    if (route.t != null && (!route.v || wanted.id === route.v)) player.pendingSeek = { t: route.t, play: false };
    setVideoId(wanted.id);
  }, [videos, videoId, route.v, route.t, routeBlock, blocks.data, player]);

  useLanding({ visit, page: page.data, source: source.data, blocks: blocks.data, block: route.block, t: route.t, videoId, player, select: setSelected, flash, setResumeId });
  useReadingPosition(route.id, sheet, !!page.data && !!source.data);

  const ops = useNotebookOps({
    pageId: route.id,
    sourceId: page.data?.sourceId ?? 0,
    myId: me.id,
    ownerName,
    author: source.data?.author ?? null,
    player,
    videos: () => videos,
    select,
    edit,
    selected: () => selectedRef.current,
    flash,
    activeEditor,
    quote: quoteRef,
  });

  const canWrite = source.data?.canWrite ?? false;
  const tags = useMemo(() => [...new Set((blocks.data ?? []).flatMap((b) => splitTags(b.tags)))], [blocks.data]);
  const ctx = useMemo<NotebookCtx>(() => ({
    ops,
    pageId: route.id,
    sourceId: page.data?.sourceId ?? 0,
    myId: me.id,
    isOwner,
    canWrite,
    ownerName,
    author: source.data?.author ?? null,
    videos,
    categories: categories.data ?? [],
    tags,
    select,
    edit,
    openImage: (blockId, imageId) => setViewer({ blockId, imageId }),
    seek: (id, t) => player.seekOn(id, t, true),
    setActiveEditor: (active) => { activeEditor.current = active; },
    openAnnotation: (id) => setAnnotating(id || null),
  }), [ops, route.id, page.data?.sourceId, me.id, isOwner, canWrite, ownerName, source.data?.author, videos, categories.data, tags, select, edit, player]);

  usePageKeys({ ctx, player, pages: pages.data ?? [], pageId: route.id, blocks: blocks.data ?? [], selected, hasVideo: videos.length > 0, editing: editing?.id ?? null });

  // Typing or navigating: the status bar says which keys work.
  useEffect(() => {
    const onFocus = () => setTyping(!!document.activeElement?.closest('.ProseMirror'));
    const onBlur = () => setTimeout(onFocus, 0);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', onBlur);
    return () => {
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', onBlur);
    };
  }, []);
  useEffect(() => {
    hints.set(typing
      ? [['Esc', 'done'], ['/', 'block type'], ['Enter', 'new block'], ['Ctrl B', 'bold'], ['Ctrl Enter', 'play / pause'], ['Ctrl [ ]', '5 s']]
      : [['J K', 'blocks'], ['Enter', 'edit'], ...(videos.length ? [['N', 'note here'], ['F', 'frame'], ['Q', 'quote'], ['Space', 'play'], ['← →', '5 s']] as Array<[string, string]> : [['N', 'note']] as Array<[string, string]>), ['[ ]', 'pages'], ['?', 'all keys']]);
  }, [typing, videos.length]);

  const slow = useDelayed(!blocks.data);
  const video = videos.find((v) => v.id === videoId) ?? null;
  const ticks = useMemo(() => (blocks.data ?? []).filter((b) => b.pageVideoId === videoId && b.videoTimeSec != null)
    .map((b) => ({ id: b.id, t: b.videoTimeSec!, label: plainText(b.body).slice(0, 80) || (b.images.length ? 'Frame' : 'Note') })), [blocks.data, videoId]);

  if (!page.data || !source.data) {
    return <div className="pg"><main className="sheet" aria-busy="true">{loadingHead(slow)}</main></div>;
  }
  const viewerBlock = viewer ? blocks.data?.find((b) => b.id === viewer.blockId) : undefined;
  const hasVideo = videos.length > 0;

  return <PlayerContext.Provider value={player}>
    <NotebookContext.Provider value={ctx}>
      <div className={`pg${pagesOpen ? '' : ' no-pages'}${focus ? ' is-focus' : ''}${hasVideo ? '' : ' no-video'}`}>
        <aside className="pagelist" aria-label="Pages">
          <PageList source={source.data} pages={pages.data ?? []} currentId={route.id} onPick={() => { if (window.innerWidth <= 1180) setPagesOpen(false); }} />
        </aside>
        {pagesOpen ? null : <button type="button" className="pl-show" aria-label="Show the page list (Ctrl \)" title="Show the page list (Ctrl \)"
          onClick={() => setPagesOpen(true)}><Icon name="chevr" /></button>}
        <div className="work" ref={(el) => el?.style.setProperty('--study-w', `${studyWidth}%`)}>
          {hasVideo && video ? <>
            <section className="study" aria-label="Video and transcript">
              <StudyPane videos={videos} video={video} ticks={ticks} ops={ops} quoteRef={quoteRef}
                onSelect={(id) => selectVideo(id)} onLocate={() => setPicker('locate')} />
            </section>
            <Splitter value={studyWidth} onChange={(w) => { setStudyWidth(w); writePref(me.id, 'studyWidth', w); }} />
          </> : null}
          <main className="sheet" ref={sheet} aria-label="Notes">
            <Notebook page={page.data} source={source.data} pages={pages.data ?? []} blocks={blocks.data} videos={videos} selected={selected}
              editing={editing?.id ?? null} editAt={editing?.at ?? null} resumeId={resumeId} annotating={annotating} filter={filter} onFilter={setFilter} slow={slow} />
            {!hasVideo && canWrite && videoList.data ? <p className="sheet-addvideo"><button type="button" className="linkbtn" onClick={() => setPicker('add')}>Add a video from the library</button></p> : null}
          </main>
        </div>
      </div>
      {viewer && viewerBlock ? <ImageViewer block={viewerBlock} imageId={viewer.imageId} pageTitle={page.data.title}
        editable={canEditBlock(viewerBlock, ctx)} onClose={() => { const id = viewer.blockId; setViewer(null); select(id); }} /> : null}
      {picker && canWrite ? <LibraryPicker mode={picker} video={picker === 'locate' ? video : null} pageId={route.id}
        sourceFolder={null} onClose={() => setPicker(null)} onDone={(message) => { setPicker(null); toast(message); invalidate(keys.videos(route.id), keys.pages(page.data!.sourceId), keys.page(route.id)); }} />
        : null}
    </NotebookContext.Provider>
  </PlayerContext.Provider>;
}

function loadingHead(show: boolean) {
  return show ? <div className="sheet-head"><span className="sk sk-w40" /><span className="sk sk-title" /><span className="sk sk-w60" /></div> : null;
}

