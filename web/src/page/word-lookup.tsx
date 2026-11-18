import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api, ApiError, NetworkError } from '../lib/api';
import { lookupKeysOpen } from '../auth/lookup-keys';
import { Icon } from '../shell/icons';
import { snapToWords } from './word-snap';
import { LookupBody, LookupHead, type WordLookupResult } from './word-lookup-body';
import { wordChat } from './word-chat';

type WordLookup = { term: string; result: WordLookupResult; cached: boolean };

/** What to look up: a selection inside one transcript line. */
export type LookupTarget = { line: number; lineEnd?: number; text: string };

/** The server refuses longer selections (`MAX_TERM_WORDS`, `MAX_SPAN_LINES`). */
const MAX_WORDS = 60;
const MAX_LINES = 4;

/** The lines a target spans, joined with spaces as the server joins them. */
export function targetLines(cues: readonly { text: string }[], target: LookupTarget): string {
  return cues.slice(target.line, (target.lineEnd ?? target.line) + 1).map((c) => c.text.replace(/\s+/g, ' ').trim()).join(' ');
}

/** The selection when it is a word, phrase or sentence within up to four consecutive lines of the transcript, else null. */
export function selectedLookup(list: HTMLElement | null): LookupTarget | null {
  const selection = document.getSelection();
  if (!list || !selection || selection.isCollapsed || !list.contains(selection.anchorNode)) return null;
  const rowOf = (node: Node | null) => (node?.nodeType === 1 ? (node as Element) : node?.parentElement)?.closest<HTMLElement>('[data-cue]');
  const ends = [rowOf(selection.anchorNode), rowOf(selection.focusNode)];
  if (!ends[0] || !ends[1]) return null;
  const [first, last] = ends.map((row) => Number(row!.dataset.cue)).sort((a, b) => a - b);
  if (last - first >= MAX_LINES) return null;
  const rows: HTMLElement[] = [];
  for (let i = first; i <= last; i++) {
    const words = list.querySelector<HTMLElement>(`[data-cue="${i}"] .tl-x`);
    if (!words) return null;
    rows.push(words);
  }
  // Where the selection starts and ends in the lines' words, joined with a space (a start on a time label counts as
  // its line's start).
  const range = selection.getRangeAt(0);
  const texts = rows.map((words) => words.textContent ?? '');
  const startOf = (index: number) => texts.slice(0, index).reduce((n, text) => n + text.length + 1, 0);
  const offset = (node: Node, at: number, words: HTMLElement, fallback: number) => {
    if (!words.contains(node)) return fallback;
    const before = document.createRange();
    before.setStart(words, 0);
    before.setEnd(node, at);
    return String(before).length;
  };
  const joined = texts.join(' ');
  const from = startOf(0) + offset(range.startContainer, range.startOffset, rows[0], 0);
  const to = startOf(rows.length - 1) + offset(range.endContainer, range.endOffset, rows[rows.length - 1], texts[texts.length - 1].length);
  const text = snapToWords(joined, from, to);
  if (!text || text.split(' ').length > MAX_WORDS) return null;
  return last > first ? { line: first, lineEnd: last, text } : { line: first, text };
}

// Answers already shown, so reopening a lookup in this tab costs no request.
const seen = new Map<string, WordLookup>();

function errorText(error: unknown): string {
  if (error instanceof NetworkError) return 'Can’t reach the server.';
  if (!(error instanceof ApiError)) return 'The lookup failed. Try again.';
  if (error.code === 'lookup-off') return 'Look up needs a Gemini API key: add your own (free), or ask the owner for a shared one.';
  if (error.code === 'lookup-key-refused') return 'Google refused the API key. Check it, or paste a new one.';
  if (error.code === 'lookup-limit') {
    const wait = Number(error.details?.retryAfterSec);
    return wait > 0 ? `Too many lookups for now. Try again in ${Math.ceil(wait / 60)} min.` : 'The free lookup quota is used up for now. Try again later.';
  }
  if (error.code === 'lookup-not-in-line') return 'Select a word or phrase inside one line.';
  if (error.code === 'lookup-failed') return 'The dictionary service did not answer. Try again.';
  return error.message;
}

/** The lookup card under a selection: the meaning in this line (Vietnamese), the lemma, other meanings, the line translated. */
export function WordLookupCard({ videoId, target, lineText, t, left, top, onSaveNote, onClose }: {
  videoId: number;
  target: LookupTarget;
  /** The line's English text, shown with the selection marked. */
  lineText: string | undefined;
  /** Where the line starts, the second a saved note is stamped at. */
  t: number;
  onSaveNote: (body: string, t: number) => void;
  left: number;
  top: number;
  onClose: () => void;
}) {
  const key = `${videoId}|${target.line}-${target.lineEnd ?? target.line}|${target.text.toLowerCase()}`;
  const [state, setState] = useState<{ data?: WordLookup; error?: unknown }>(() => ({ data: seen.get(key) }));
  const [attempt, setAttempt] = useState(0);
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (seen.has(key)) return setState({ data: seen.get(key) });
    const abort = new AbortController();
    setState({});
    api<WordLookup>(`/page-videos/${videoId}/word-lookup`, { method: 'POST', body: target, signal: abort.signal })
      .then((data) => { seen.set(key, data); setState({ data }); })
      .catch((error: unknown) => { if (!abort.signal.aborted) setState({ error }); });
    return () => abort.abort();
    // `target` is what `key` names; a new object for the same selection must not ask again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  // Under the selection, moved up when it would run past the bottom of the study pane (which clips it).
  useLayoutEffect(() => {
    const el = box.current;
    const host = el?.offsetParent as HTMLElement | null;
    if (!el || !host) return;
    el.style.left = `${Math.max(8, Math.min(left, host.clientWidth - el.offsetWidth - 8))}px`;
    el.style.top = `${Math.max(8, Math.min(top, host.clientHeight - el.offsetHeight - 8))}px`;
  }, [left, top, state]);

  // Escape or a press anywhere else closes it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onPress = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) onClose(); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPress);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPress);
    };
  }, [onClose]);

  const r = state.data?.result;
  // A phrase reads as selected; a single word shows its dictionary form ("grasped" → "grasp").
  const title = r && !target.text.includes(' ') && r.lemma ? r.lemma : target.text;
  return <div className="wl-card" role="dialog" aria-label={`Meaning of ${target.text}`} ref={box}>
    <button type="button" className="wl-close" aria-label="Close" onClick={onClose}><Icon name="close" /></button>
    <LookupHead title={title} result={r} />
    {r ? <>
      <LookupBody result={r} term={target.text} line={lineText} />
      <footer className="wl-actions">
        <button type="button" className="btn btn-primary" onClick={() => { wordChat.set({ videoId, target, t, result: r }); onClose(); }}>
          <Icon name="question" /> Ask more</button>
        <button type="button" className="btn" onClick={() => {
          onSaveNote(`**${title}**${r.ipa ? ` ${r.ipa}` : ''}${r.partOfSpeech ? ` · *${r.partOfSpeech}*` : ''}: ${r.meaning}\n\n${r.explanation}`, t);
          onClose();
        }}><Icon name="note" /> Save to notes</button>
      </footer>
    </> : state.error ? <div className="wl-error">
      <p>{errorText(state.error)}</p>
      {state.error instanceof ApiError && ['lookup-off', 'lookup-key-refused'].includes(state.error.code ?? '')
        ? <button type="button" className="btn" onClick={() => { onClose(); lookupKeysOpen.set(true); }}>Set up a key</button>
        : state.error instanceof ApiError && state.error.code === 'lookup-not-in-line' ? null
        : <button type="button" className="btn" onClick={() => setAttempt((n) => n + 1)}>Try again</button>}
    </div> : <p className="wl-wait">Looking up…</p>}
  </div>;
}
