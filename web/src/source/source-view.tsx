import { useEffect, useState } from 'react';
import { isNotFound } from '../lib/api';
import { keys, useInsights, usePages, useQuestions, useSource } from '../lib/data';
import { invalidate, mutate, useDelayed } from '../lib/resource';
import { Link, navigate, paths, type SourceTab } from '../lib/router';
import { failureText, save, send } from '../lib/saves';
import { useSession } from '../lib/session';
import { hints, toast } from '../lib/shell-state';
import type { Page, Source } from '../lib/types';
import { Icon } from '../shell/icons';
import { SourceAvatar } from '../shell/marks';
import { KIND_LABEL } from './source-dialog';
import { openSourceDialog } from './source-dialog-state';
import { PagesTab } from './pages-tab';
import { InsightsTab } from './insights-tab';
import { QuestionsTab } from './questions-tab';
import { ImportDialog } from './import-dialog';
import { useKeys } from '../lib/keys';

/** A source (design-spec §5.3): header, its writers' actions, and the Pages · Insights · Questions tabs. */
export function SourceView({ sourceId, tab }: { sourceId: number; tab: SourceTab }) {
  const { ownerName } = useSession();
  const source = useSource(sourceId);
  const canWrite = source.data?.canWrite ?? false;
  const pages = usePages(sourceId);
  const insights = useInsights(sourceId);
  const questions = useQuestions(sourceId, 'all');
  const [importing, setImporting] = useState(false);
  const slow = useDelayed(source.loading);

  useEffect(() => {
    if (isNotFound(source.error)) {
      toast('You no longer have access to that source.');
      invalidate(keys.sources);
      navigate(paths.home(), { replace: true });
    }
  }, [source.error]);

  useEffect(() => {
    hints.set([['J K', 'move'], ['Enter', 'open'], ...(canWrite ? [['Alt ↑ ↓', 'reorder']] as Array<[string, string]> : []), ['G I', 'insights'], ['/', 'search here'], ['?', 'all keys']]);
  }, [canWrite]);

  useKeys((event, typing) => {
    if (typing || event.ctrlKey || event.metaKey || event.altKey || (event.code !== 'KeyJ' && event.code !== 'KeyK')) return false;
    const rows = [...document.querySelectorAll<HTMLElement>('.tab-body .prow-t, .tab-body .insight a, .tab-body .row')];
    if (!rows.length) return false;
    const at = rows.indexOf(document.activeElement as HTMLElement);
    rows[Math.max(0, Math.min(rows.length - 1, at + (event.code === 'KeyJ' ? 1 : -1)))]?.focus();
    return true;
  });

  const s = source.data;
  if (!s) return <div className="view-scroll"><div className="src" aria-busy="true">{slow ? <span className="sk sk-title" /> : null}</div></div>;

  const newPage = async () => {
    try {
      const page = await send<Page>(`/sources/${s.id}/pages`, { method: 'POST', body: { title: 'Untitled page' } });
      invalidate(keys.pages(s.id), keys.source(s.id), keys.sources);
      navigate(paths.page(page.id));
      setTimeout(() => {
        const title = document.getElementById('page-title') as HTMLTextAreaElement | null;
        title?.focus();
        title?.select();
      }, 120);
    } catch (error) {
      toast(failureText(error, ownerName));
    }
  };

  const openCount = s.openQuestionCount;
  const tabs: Array<[SourceTab, string, string | number]> = [
    ['pages', 'Pages', pages.data?.length ?? s.pageCount],
    ['insights', 'Insights', s.insightCount],
    ['questions', 'Questions', openCount ? `${openCount} open` : questions.data?.total ?? 0],
  ];

  return <div className="view-scroll"><div className="src">
    <header className="src-head">
      <SourceAvatar source={s} size="lg" />
      <div className="src-head-main">
        {s.kind ? <div className="label">{KIND_LABEL[s.kind]}</div> : null}
        <h1 className="src-title">{s.name}</h1>
        <div className="src-meta">{[s.author, `${s.watchedPageCount} of ${s.pageCount} pages watched`, `${s.insightCount} insights`].filter(Boolean).join(' · ')}</div>
        <Description source={s} />
      </div>
      {canWrite ? <div className="src-actions">
        <button type="button" className="btn" onClick={() => openSourceDialog(s)}><Icon name="edit" /> Edit</button>
        <button type="button" className="btn" onClick={() => void newPage()}><Icon name="plus" /> New page</button>
        <button type="button" className="btn btn-primary" onClick={() => setImporting(true)}><Icon name="folder" /> Import a folder</button>
      </div> : null}
    </header>
    <div className="tabs" role="tablist" aria-label={s.name}>
      {tabs.map(([key, label, n]) => <Link key={key} to={paths.source(s.id, key)} role="tab" className={`tab${tab === key ? ' is-on' : ''}`} aria-selected={tab === key}>
        {label} <span>{n}</span></Link>)}
    </div>
    <div className="tab-body" role="tabpanel">
      {tab === 'pages' ? <PagesTab source={s} pages={pages.data} onImport={() => setImporting(true)} onNewPage={() => void newPage()} />
        : tab === 'insights' ? <InsightsTab source={s} insights={insights.data} pages={pages.data ?? []} />
        : <QuestionsTab sourceId={s.id} />}
    </div>
    {importing ? <ImportDialog source={s} pageCount={pages.data?.length ?? 0} onClose={() => setImporting(false)} /> : null}
  </div></div>;
}

/** The description, edited in place by those who may change the source; saved when the field is left. */
function Description({ source }: { source: Source }) {
  const { ownerName } = useSession();
  const [value, setValue] = useState(source.description ?? '');
  useEffect(() => setValue(source.description ?? ''), [source.description]);
  if (!source.canWrite) return source.description ? <p className="src-desc" lang="vi">{source.description}</p> : null;
  return <textarea className="src-desc src-desc-in" rows={1} value={value} placeholder="Add a description" aria-label="Description" lang="vi"
    ref={(el) => { if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; } }}
    onChange={(e) => setValue(e.target.value)}
    onBlur={() => {
      if (value.trim() === (source.description ?? '')) return;
      mutate<Source>(keys.source(source.id), (s) => ({ ...s, description: value.trim() || null }));
      save('PUT', `/sources/${source.id}`, { description: value.trim() }).then(() => invalidate(keys.sources), (error: unknown) => toast(failureText(error, ownerName)));
    }} />;
}
