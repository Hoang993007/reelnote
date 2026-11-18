import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { api, ApiError } from '../lib/api';
import { copyToClipboard } from '../lib/clipboard';
import { fmtTime } from '../lib/format';
import { useResource } from '../lib/resource';
import { toast } from '../lib/shell-state';
import type { Transcript as TranscriptData, TranscriptCue } from '../lib/types';
import { Icon } from '../shell/icons';
import { openMenu } from '../shell/menu';
import { usePlayer } from './player-controller';
import { cueAt } from './transcript-cues';
import { transcriptAsText, transcriptWithTimes } from './transcript-text';
import { selectedLookup, targetLines, WordLookupCard, type LookupTarget } from './word-lookup';
import { WordChatHost } from './word-chat';

async function copy(text: string, what: string): Promise<void> {
  toast(await copyToClipboard(text) ? `${what} copied` : 'Could not copy. Select the text and press Ctrl C.');
}

/** What Quote takes: the selected transcript text (at its line's time), else the current line. */
export type QuoteSource = { text: string; t: number };

export function useTranscript(videoId: number | null) {
  return useResource(videoId ? `transcript:${videoId}` : null, () => api<TranscriptData>(`/page-videos/${videoId}/transcript`));
}

/** The selection inside the transcript list, with the start time of the line it starts in. */
function selectedQuote(list: HTMLElement | null, cues: readonly TranscriptCue[]): QuoteSource | null {
  const selection = document.getSelection();
  if (!list || !selection || selection.isCollapsed || !selection.rangeCount || !list.contains(selection.anchorNode)) return null;
  const text = String(selection).replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const node = selection.anchorNode;
  const row = (node?.nodeType === 1 ? (node as Element) : node?.parentElement)?.closest<HTMLElement>('[data-cue]');
  const cue = row ? cues[Number(row.dataset.cue)] : undefined;
  // A selection that starts on a time label drops it.
  return { text: text.replace(/^\d{1,2}:\d{2}(:\d{2})?\s*/, ''), t: cue?.startSec ?? 0 };
}

/**
 * The transcript (design-spec §5.4): the current line highlighted and kept a third of the way down; a line's time
 * is a button that seeks and plays, its words select like any text; scrolling by hand pauses following ("Back to
 * current line"); selecting text offers Quote and Copy, and Look up for a word or phrase in one line; the head copies
 * the whole transcript.
 */
export function Transcript({ videoId, onQuote, onSaveNote, quoteRef }: {
  videoId: number;
  onQuote: (source: QuoteSource) => void;
  /** Keeps a lookup or a chat answer as a note at second `t`. */
  onSaveNote: (body: string, t: number) => void;
  /** Filled with a function that reads the quote Q would take now. */
  quoteRef: { current: () => QuoteSource | null };
}) {
  const player = usePlayer();
  const transcript = useTranscript(videoId);
  const cues = transcript.data?.cues ?? [];
  const list = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const [pop, setPop] = useState<{ left: number; top: number; lookup: LookupTarget | null } | null>(null);
  const [card, setCard] = useState<{ left: number; top: number; target: LookupTarget } | null>(null);
  const closeCard = useCallback(() => setCard(null), []);
  const active = useSyncExternalStore(player.state.subscribe, () => cueAt(cues, player.state.get().t));

  quoteRef.current = () => {
    const picked = selectedQuote(list.current, cues);
    if (picked) return picked;
    const index = cueAt(cues, player.now());
    const cue = cues[Math.max(0, index)];
    return cue ? { text: cue.text.replace(/\s+/g, ' ').trim(), t: cue.startSec } : null;
  };

  useLayoutEffect(() => {
    const box = list.current;
    if (!follow || !box || active < 0) return;
    const row = box.querySelector<HTMLElement>(`[data-cue="${active}"]`);
    if (!row) return;
    const selection = document.getSelection();
    if (selection && !selection.isCollapsed && box.contains(selection.anchorNode)) return;
    box.scrollTo({ top: row.offsetTop - box.clientHeight / 3, behavior: 'smooth' });
  }, [active, follow]);

  useEffect(() => {
    const hide = () => {
      if (!String(document.getSelection() ?? '').trim()) setPop(null);
    };
    document.addEventListener('selectionchange', hide);
    return () => document.removeEventListener('selectionchange', hide);
  }, []);

  const showPop = useCallback(() => {
    const box = list.current;
    const selection = document.getSelection();
    if (!box || !selection || selection.isCollapsed || !box.contains(selection.anchorNode)) return setPop(null);
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    const host = box.parentElement!.getBoundingClientRect();
    setPop({ left: Math.max(8, rect.left - host.left), top: rect.bottom - host.top + 6, lookup: selectedLookup(box) });
  }, []);

  const error = transcript.error;
  if (transcript.loading) return <TranscriptHead follow={null} onFollow={() => undefined} />;
  if (error || !cues.length) {
    const busy = error instanceof ApiError && error.code === 'transcript-busy';
    const fileGone = error instanceof ApiError && ['video-file-missing', 'video-outside-root', 'library-root-missing'].includes(error.code ?? '');
    const text = busy ? 'The PC is busy reading other transcripts.'
      : fileGone ? 'The video file is missing, so its transcript cannot be read.'
      : error instanceof ApiError && error.code === 'transcript-unsupported' ? 'The transcript inside this file cannot be read.'
      : error ? 'The transcript cannot be read right now.'
      : 'This video has no English or Vietnamese subtitle track. Transcripts come from the video file’s subtitles.';
    return <>
      <TranscriptHead follow={null} onFollow={() => undefined} />
      <div className="tr-empty"><strong>{busy || error ? 'Transcript not available' : 'No transcript'}</strong><p>{text}</p>
        {busy || (error && !(error instanceof ApiError)) ? <button type="button" className="btn" onClick={() => void transcript.reload()}>Try again</button> : null}
        <p className="muted">You can still watch and take notes.</p></div>
    </>;
  }

  return <>
    <TranscriptHead follow={follow} onFollow={() => setFollow(true)} cues={cues} />
    <div className="transcript" ref={list} tabIndex={0} aria-label="Transcript. Click a time to play from it; select text to quote or copy it."
      onWheel={() => setFollow(false)} onTouchMove={() => setFollow(false)} onMouseUp={() => setTimeout(showPop, 0)} onKeyUp={() => showPop()}>
      {cues.map((cue, i) => <Line key={i} index={i} cue={cue} now={i === active} />)}
    </div>
    {pop ? <div className="quote-pop" ref={(el) => { if (el) { el.style.left = `${pop.left}px`; el.style.top = `${pop.top}px`; } }}
      onMouseDown={(e) => e.preventDefault()}>
      <button type="button" className="qp-btn" onClick={() => {
        const picked = selectedQuote(list.current, cues);
        setPop(null);
        if (picked) onQuote(picked);
      }}><Icon name="quote" /> Quote to notes <kbd>Q</kbd></button>
      <button type="button" className="qp-btn" onClick={() => {
        const picked = selectedQuote(list.current, cues);
        setPop(null);
        if (picked) void copy(picked.text, 'Selection');
      }}><Icon name="copy" /> Copy</button>
      {pop.lookup ? <button type="button" className="qp-btn" onClick={() => {
        setCard({ left: pop.left, top: pop.top, target: pop.lookup! });
        setPop(null);
      }}><Icon name="search" /> Look up</button> : null}
    </div> : null}
    {card ? <WordLookupCard key={`${card.target.line}-${card.target.lineEnd}|${card.target.text}`} videoId={videoId} target={card.target}
      lineText={targetLines(cues, card.target)} t={cues[card.target.line]?.startSec ?? 0} onSaveNote={onSaveNote}
      left={card.left} top={card.top} onClose={closeCard} /> : null}
    <WordChatHost onSaveNote={onSaveNote} />
  </>;
}

function TranscriptHead({ follow, onFollow, cues }: { follow: boolean | null; onFollow: () => void; cues?: readonly TranscriptCue[] }) {
  return <div className="tr-head">
    <span className="label">Transcript · English</span>
    <span className="tr-tools">
      {cues?.length ? <button type="button" className="linkbtn tr-copy" title="Copy the whole transcript"
        onClick={(e) => openMenu(e.currentTarget, [
          { label: 'Copy the text', icon: 'copy', run: () => void copy(transcriptAsText(cues), 'Transcript') },
          { label: 'Copy with times', icon: 'copy', run: () => void copy(transcriptWithTimes(cues), 'Transcript') },
        ], { alignRight: true })}><Icon name="copy" /> Copy</button> : null}
      {follow === null ? null : <button type="button" className="linkbtn" onClick={onFollow} disabled={follow}>{follow ? 'Following playback' : 'Back to current line'}</button>}
    </span>
  </div>;
}

/** A line: its time is the button that plays from there; the words are plain text to select and copy. */
const Line = memo(function Line({ index, cue, now }: { index: number; cue: TranscriptCue; now: boolean }) {
  const player = usePlayer();
  const time = fmtTime(cue.startSec);
  return <div className={`tl${now ? ' is-now' : ''}`} data-cue={index} aria-current={now || undefined}>
    <button type="button" className="mono tl-t" title={`Play from ${time}`} aria-label={`Play from ${time}`}
      onClick={() => player.seek(cue.startSec, true)}>{time}</button>
    <span className="tl-x">{cue.text}</span>
  </div>;
});
