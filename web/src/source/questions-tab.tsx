import { useState } from 'react';
import { useQuestions } from '../lib/data';
import type { QuestionState } from '../lib/types';
import { QuestionRow } from '../home/question-row';

/** Questions (design-spec §5.3): Open · Answered · All, each opening the page at the block. */
export function QuestionsTab({ sourceId }: { sourceId: number }) {
  const [state, setState] = useState<QuestionState | 'all'>('open');
  const questions = useQuestions(sourceId, state);
  const items = questions.data?.items ?? [];
  return <div className="qs">
    <div className="seg" role="group" aria-label="Question status">
      {([['open', 'Open'], ['answered', 'Answered'], ['all', 'All']] as Array<[QuestionState | 'all', string]>).map(([key, label]) =>
        <button key={key} type="button" className={state === key ? 'is-on' : ''} aria-pressed={state === key} onClick={() => setState(key)}>{label}</button>)}
    </div>
    {questions.loading ? null : items.length ? <ul className="list">{items.map((q) => <li key={q.blockId}><QuestionRow q={q} /></li>)}</ul>
      : <div className="empty"><h3>Nothing here</h3><p>Type <kbd>?</kbd> and a space at the start of a note, or pick “Open question” from the <kbd>/</kbd> menu.</p></div>}
  </div>;
}
