import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { keys, useQuestions, useRecent, useSources, useVideos } from '../lib/data';
import { fold } from '../lib/fold';
import { excerpt, firstParagraph, plainText } from '../lib/markdown';
import { fmtTime, fmtWhen } from '../lib/format';
import { closestTo, useKeys } from '../lib/keys';
import { useResource, useDelayed } from '../lib/resource';
import { Link, navigate, paths } from '../lib/router';
import { useSession } from '../lib/session';
import { hints } from '../lib/shell-state';
import type { Block, ContinuePage, PageVideo, Source } from '../lib/types';
import { Icon } from '../shell/icons';
import { ProgressMark, SourceAvatar } from '../shell/marks';
import { openSourceDialog } from '../source/source-dialog-state';
import { KIND_LABEL } from '../source/source-dialog';
import { QuestionRow } from './question-row';

/** Home (design-spec §5.2): Continue, recent pages, open questions, sources. */
export function HomeView() {
  const recent = useRecent();
  const sources = useSources();
  const questions = useQuestions('all', 'open');
  const [first, ...rest] = recent.data ?? [];
  const slow = useDelayed(recent.loading || sources.loading);

  useEffect(() => {
    hints.set([['Enter', 'resume'], ['Alt 1–9', 'sources'], ['Ctrl K', 'search'], ['G S', 'all sources'], ['?', 'all keys']]);
  }, []);

  useKeys((event, typing) => {
    if (typing || event.key !== 'Enter' || event.ctrlKey || event.altKey || !first) return false;
    if (closestTo(event.target, 'a, button, input')) return false;
    navigate(paths.page(first.pageId));
    return true;
  });

  if (recent.loading || sources.loading) return <div className="view-scroll"><div className="home" aria-busy="true">{slow ? <HomeSkeleton /> : null}</div></div>;

  return <div className="view-scroll"><div className="home">
    {first ? <ContinueCard cont={first} /> : <StartHere source={sources.data?.[0]} />}
    <div className="home-cols">
      <section aria-labelledby="h-recent">
        <h2 className="sec-h" id="h-recent">Recent pages</h2>
        {rest.length ? <ul className="list">{rest.slice(0, 8).map((p) => <li key={p.pageId}>
          <Link to={paths.page(p.pageId)} className="row">
            <SourceAvatar source={{ name: p.sourceName, color: p.sourceColor }} size="sm" />
            <span className="row-main"><span className="row-t">{p.pageTitle}</span><span className="row-m">{p.sourceName} · {fmtWhen(p.lastViewedAt)}</span></span>
            <ProgressMark state={p.watchState} />
          </Link></li>)}</ul> : <p className="muted pad">Pages you open show up here.</p>}
      </section>
      <section aria-labelledby="h-q">
        <h2 className="sec-h" id="h-q">Open questions <span className="count">{questions.data?.total ?? ''}</span></h2>
        {questions.data?.items.length ? <ul className="list">{questions.data.items.slice(0, 12).map((q) => <li key={q.blockId}><QuestionRow q={q} withSource /></li>)}</ul>
          : <p className="muted pad">No open questions. Type <kbd>?</kbd> and a space at the start of a note, or pick “Open question” from the <kbd>/</kbd> menu.</p>}
      </section>
    </div>
    <SourcesGrid sources={sources.data ?? []} heading="Sources" />
  </div></div>;
}

function HomeSkeleton() {
  return <>
    <div className="continue"><span className="sk cont-sk" /><div className="cont-body"><span className="sk sk-w40" /><span className="sk sk-title" /><span className="sk sk-w60" /></div></div>
    <div className="home-cols">{[0, 1].map((i) => <div key={i}>{[0, 1, 2].map((j) => <span key={j} className="sk sk-row" />)}</div>)}</div>
  </>;
}

function StartHere({ source }: { source: Source | undefined }) {
  const button = useRef<HTMLAnchorElement>(null);
  useEffect(() => { button.current?.focus({ preventScroll: true }); }, []);
  return <section className="continue continue-empty" aria-labelledby="h-cont">
    <div className="cont-body">
      <div className="label" id="h-cont">Start here</div>
      <h1 className="cont-title">Nothing opened yet</h1>
      <p className="muted">Pick a source below. Reelnote remembers the page, the block you read last and where each video stopped.</p>
      {source ? <div className="cont-actions"><Link ref={button} to={paths.source(source.id)} className="btn btn-primary">Open {source.name}</Link></div> : null}
    </div>
  </section>;
}

/** The video a page resumes on: the first not yet watched, else the first. */
export function resumeVideo(videos: readonly PageVideo[]): PageVideo | null {
  return videos.find((v) => !v.completed) ?? videos[0] ?? null;
}

function ContinueCard({ cont }: { cont: ContinuePage }) {
  const videos = useVideos(cont.pageId).data?.videos ?? [];
  const video = resumeVideo(videos);
  const lastBlock = useResource(cont.lastBlockId ? `block:${cont.lastBlockId}` : null, () => api<Block>(`/blocks/${cont.lastBlockId}`)).data;
  const resume = useRef<HTMLAnchorElement>(null);
  useEffect(() => { resume.current?.focus({ preventScroll: true }); }, []);
  const reading = lastBlock ? excerpt(lastBlock.kind === 'question' ? firstParagraph(lastBlock.body) : plainText(lastBlock.body), 90) : '';
  const position = video ? video.lastPositionSec : 0;
  const label = video && videos.length > 1 ? video.title : 'Video';

  return <section className="continue" aria-labelledby="h-cont">
    <Link to={paths.page(cont.pageId)} className="cont-thumb" aria-label={`Resume ${cont.pageTitle}`} tabIndex={-1}>
      {video ? <video src={`/api/page-videos/${video.id}/stream${video.revision ? `?v=${encodeURIComponent(video.revision)}` : ''}#t=${Math.floor(position)}`}
        preload="metadata" muted playsInline tabIndex={-1} aria-hidden="true" />
        : <span className="cont-paper"><SourceAvatar source={{ name: cont.sourceName, color: cont.sourceColor }} size="lg" /></span>}
      {video?.durationSec ? <span className="cont-bar"><span ref={(el) => el?.style.setProperty('width', `${Math.min(100, (position / video.durationSec!) * 100)}%`)} /></span> : null}
    </Link>
    <div className="cont-body">
      <div className="label" id="h-cont">Continue where you left off</div>
      <Link to={paths.source(cont.sourceId)} className="cont-src"><SourceAvatar source={{ name: cont.sourceName, color: cont.sourceColor }} size="xs" />{cont.sourceName}</Link>
      <h1 className="cont-title">{cont.pageTitle}</h1>
      <dl className="cont-where">
        {video ? <div><dt>Video</dt><dd>{label} at <span className="mono">{fmtTime(position)}</span>{video.durationSec ? <> of <span className="mono">{fmtTime(video.durationSec)}</span></> : null}</dd></div> : null}
        {reading ? <div><dt>Reading</dt><dd className="cont-read">“{reading}”</dd></div> : null}
      </dl>
      <div className="cont-actions">
        <Link ref={resume} to={paths.page(cont.pageId)} className="btn btn-primary">Resume <kbd>Enter</kbd></Link>
        <Link to={paths.source(cont.sourceId)} className="btn">All pages in {cont.sourceName}</Link>
      </div>
    </div>
  </section>;
}

function SourcesGrid({ sources, heading }: { sources: Source[]; heading: string }) {
  const { isOwner } = useSession();
  const [filter, setFilter] = useState('');
  const shown = useMemo(() => {
    const q = fold(filter.trim());
    return sources.map((s, i) => ({ s, i })).filter(({ s }) => !q || fold(`${s.name} ${s.author ?? ''}`).includes(q));
  }, [sources, filter]);

  return <section aria-labelledby="h-src">
    <div className="sec-row">
      <h2 className="sec-h" id="h-src">{heading} <span className="count">{sources.length}</span></h2>
      <label className="filter-in"><Icon name="search" /><input placeholder="Filter sources" aria-label="Filter sources" value={filter} onChange={(e) => setFilter(e.target.value)} /></label>
      {isOwner ? <button type="button" className="btn" onClick={() => openSourceDialog(null)}><Icon name="plus" /> Add source</button> : null}
    </div>
    {sources.length === 0 ? <div className="empty"><h3>No sources yet</h3>
      <p>{isOwner ? 'Add a source (a mentor, a book, a channel or a course), then import a folder of its videos.' : 'You cannot open any source yet. Ask the owner for access.'}</p>
      {isOwner ? <div className="empty-actions"><button type="button" className="btn btn-primary" onClick={() => openSourceDialog(null)}>Add a source</button></div> : null}</div> : null}
    <div className="src-grid">
      {shown.map(({ s, i }) => <Link key={s.id} to={paths.source(s.id)} className="src-card">
        <SourceAvatar source={s} size="md" />
        <span className="src-main">
          <span className="src-name">{s.name}</span>
          <span className="src-by">{[s.kind ? KIND_LABEL[s.kind] : null, s.author].filter(Boolean).join(' · ') || ' '}</span>
          <span className="src-prog"><span className="bar"><span ref={(el) => el?.style.setProperty('width', `${s.pageCount ? (s.watchedPageCount / s.pageCount) * 100 : 0}%`)} /></span>
            <span>{s.watchedPageCount} of {s.pageCount} watched</span></span>
        </span>
        {i < 9 ? <kbd className="src-key">Alt {i + 1}</kbd> : null}
      </Link>)}
    </div>
  </section>;
}

export const homeKeys = keys;
