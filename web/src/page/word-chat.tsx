import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { api, ApiError, NetworkError } from '../lib/api';
import { renderMarkdown } from '../lib/markdown';
import { createStore, useStore } from '../lib/store';
import { Icon } from '../shell/icons';
import type { WordLookupResult } from './word-lookup-body';
import type { LookupTarget } from './word-lookup';

/** What a chat is about: a lookup and its answer, in one transcript line that starts at `t`. */
export type ChatAbout = { videoId: number; target: LookupTarget; t: number; result: WordLookupResult };
type Turn = { role: 'user' | 'model'; text: string };

/** The open chat (one at a time); null = closed. Closing forgets it: keep an answer with Save to notes. */
export const wordChat = createStore<ChatAbout | null>(null);

/** The server takes at most 19 turns: about ten questions. */
const MAX_TURNS = 19;
const SUGGESTIONS = [
  { label: 'More examples', ask: 'Give me three more example sentences with it, on the same subject if you can.' },
  { label: 'Synonyms', ask: 'What are its synonyms or close words, and how do they differ?' },
  { label: 'Common phrases', ask: 'What are the common phrases or collocations with it? Give a short example for each.' },
  { label: 'Grammar', ask: 'Explain the grammar of it in this line.' },
];

function errorText(error: unknown): string {
  if (error instanceof NetworkError) return 'Can’t reach the server.';
  if (error instanceof ApiError && error.code === 'lookup-limit') return 'Too many questions for now. Try again in a few minutes.';
  if (error instanceof ApiError && error.code === 'lookup-key-refused') return 'Google refused the API key.';
  return 'No answer came back. Try again.';
}

export function WordChatHost({ onSaveNote }: { onSaveNote: (body: string, t: number) => void }) {
  const about = useStore(wordChat);
  if (!about) return null;
  return createPortal(<WordChat key={`${about.videoId}|${about.target.line}-${about.target.lineEnd}|${about.target.text}`} about={about}
    onSaveNote={onSaveNote} onClose={() => wordChat.set(null)} />, document.body);
}

/** The chat panel at the right edge, over the notes: questions about one lookup, answered by Gemini. */
function WordChat({ about, onSaveNote, onClose }: { about: ChatAbout; onSaveNote: (body: string, t: number) => void; onClose: () => void }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; retry: Turn[] } | null>(null);
  const [saved, setSaved] = useState<number[]>([]);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const full = turns.length >= MAX_TURNS;

  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [turns, busy, error]);

  const send = async (next: Turn[]) => {
    setTurns(next);
    setBusy(true);
    setError(null);
    try {
      const { reply } = await api<{ reply: string }>(`/page-videos/${about.videoId}/word-chat`, {
        method: 'POST', body: { ...about.target, turns: next },
      });
      setTurns([...next, { role: 'model', text: reply }]);
    } catch (failure) {
      setError({ text: errorText(failure), retry: next });
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  };
  const ask = (question: string) => {
    const text = question.trim();
    if (!text || busy || full) return;
    setDraft('');
    void send([...turns, { role: 'user', text }]);
  };
  const submit = (event: FormEvent) => { event.preventDefault(); ask(draft); };
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); ask(draft); }
  };
  const save = (index: number) => {
    const question = turns[index - 1]?.text ?? '';
    onSaveNote(`**${about.target.text}**: ${question}\n\n${turns[index].text}`, about.t);
    setSaved((list) => [...list, index]);
  };

  return <aside className="wc" role="dialog" aria-label={`Questions about ${about.target.text}`}
    onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
    <header className="wc-head">
      <div className="wc-title"><span className="wc-kicker">Ask about</span><strong>{about.target.text}</strong></div>
      <button type="button" className="wl-close" aria-label="Close" onClick={onClose}><Icon name="close" /></button>
      <p className="wc-gist" lang="vi">{about.result.meaning}</p>
    </header>
    <div className="wc-log">
      {!turns.length ? <p className="wc-empty">Ask anything about it: more examples, how it differs from a similar word, the grammar of the line… Answers come in Vietnamese.</p> : null}
      {turns.map((turn, i) => turn.role === 'user'
        ? <div key={i} className="wc-msg wc-me">{turn.text}</div>
        : <div key={i} className="wc-msg wc-ai">
          <div className="md" lang="vi" dangerouslySetInnerHTML={{ __html: renderMarkdown(turn.text) }} />
          <button type="button" className="linkbtn wc-save" disabled={saved.includes(i)} onClick={() => save(i)}>
            <Icon name={saved.includes(i) ? 'check' : 'note'} />{saved.includes(i) ? 'Saved to notes' : 'Save to notes'}</button>
        </div>)}
      {busy ? <div className="wc-msg wc-ai wc-wait">Thinking…</div> : null}
      {error ? <div className="wc-error"><span>{error.text}</span>
        <button type="button" className="btn" onClick={() => void send(error.retry)}>Try again</button></div> : null}
      <div ref={end} />
    </div>
    <footer className="wc-foot">
      {full ? <p className="muted">This chat is full. Close it and look the words up again for a new one.</p> : <>
        <div className="wc-chips">{SUGGESTIONS.map((s) => <button key={s.label} type="button" className="wc-chip" disabled={busy}
          onClick={() => ask(s.ask)}>{s.label}</button>)}</div>
        <form className="wc-ask" onSubmit={submit}>
          <textarea ref={input} rows={2} value={draft} placeholder="Ask a question… (Enter sends, Shift Enter for a new line)"
            onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} maxLength={1000} />
          <button type="submit" className="btn btn-primary" disabled={busy || !draft.trim()}>Send</button>
        </form>
      </>}
    </footer>
  </aside>;
}
