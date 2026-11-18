import type { ReactNode } from 'react';
import { Icon } from '../shell/icons';

/** The server's answer (`server/src/lookup/word-lookup-types.ts`). */
export type WordLookupResult = {
  lemma: string;
  ipa: string;
  partOfSpeech: string;
  meaning: string;
  explanation: string;
  otherMeanings: string[];
  lineTranslation: string;
};

const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window;

/** Reads `text` aloud in English with the browser's own voice (no network). */
function say(text: string): void {
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.rate = 0.9;
  window.speechSynthesis.speak(utterance);
}

/** The line with the looked-up words marked (first match, ignoring case and spacing). */
function marked(line: string, term: string): ReactNode {
  const words = term.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const match = new RegExp(words.join('\\s+'), 'i').exec(line);
  if (!match) return line;
  return <>{line.slice(0, match.index)}<mark>{match[0]}</mark>{line.slice(match.index + match[0].length)}</>;
}

/** The card's head: the word large, a button that says it, its IPA and part of speech. */
export function LookupHead({ title, result }: { title: string; result: WordLookupResult | undefined }) {
  const long = title.split(' ').length > 4;
  return <header className="wl-top">
    <div className="wl-word">
      <span className={`wl-term${long ? ' is-long' : ''}`}>{title}</span>
      {canSpeak ? <button type="button" className="wl-say" title="Listen" aria-label={`Listen to ${title}`} onClick={() => say(title)}>
        <Icon name="volume" /></button> : null}
    </div>
    {result && (result.ipa || result.partOfSpeech) ? <div className="wl-meta">
      {result.ipa ? <span className="wl-ipa">{result.ipa}</span> : null}
      {result.partOfSpeech ? <span className="wl-pos" lang="vi">{result.partOfSpeech}</span> : null}
    </div> : null}
  </header>;
}

/** The answer: the meaning in this line first, then the line itself with its translation, then other meanings. */
export function LookupBody({ result, term, line }: { result: WordLookupResult; term: string; line: string | undefined }) {
  return <div className="wl-body">
    <section className="wl-here">
      <div className="wl-label">In this line</div>
      <div className="wl-meaning" lang="vi">{result.meaning}</div>
      {result.explanation ? <p className="wl-why" lang="vi">{result.explanation}</p> : null}
    </section>
    {line || result.lineTranslation ? <section>
      <div className="wl-label">The line</div>
      <div className="wl-context">
        {line ? <p className="wl-src">{marked(line, term)}</p> : null}
        {result.lineTranslation ? <p className="wl-tr" lang="vi">{result.lineTranslation}</p> : null}
      </div>
    </section> : null}
    {result.otherMeanings.length ? <section>
      <div className="wl-label">Other meanings</div>
      <ol className="wl-list" lang="vi">{result.otherMeanings.map((m) => <li key={m}>{m}</li>)}</ol>
    </section> : null}
  </div>;
}
