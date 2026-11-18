import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import { mutate, useResource } from '../lib/resource';
import { useSession } from '../lib/session';
import { toast } from '../lib/shell-state';
import { createStore, useStore } from '../lib/store';
import { Dialog } from '../shell/dialog';

/** What `GET /api/lookup-keys` answers: only the last four characters of a key, never the key. */
type LookupKeyStatus = { own: string | null; shared: { set: boolean; last4: string | null; from: 'app' | 'env' | null } };

const KEY = 'lookup-keys';
const AI_STUDIO = 'https://aistudio.google.com/';

/** Word lookup key (everyone, from the account menu; also opened from a lookup that has no key). */
export const lookupKeysOpen = createStore(false);

export function LookupKeysHost() {
  const open = useStore(lookupKeysOpen);
  return open ? <Dialog title="Word lookup key" onClose={() => lookupKeysOpen.set(false)}><LookupKeys /></Dialog> : null;
}

function LookupKeys() {
  const { isOwner } = useSession();
  const status = useResource(KEY, () => api<LookupKeyStatus>('/lookup-keys')).data;
  const save = async (which: 'own' | 'shared', key: string | null): Promise<boolean> => {
    try {
      const next = await api<LookupKeyStatus>(`/lookup-keys/${which}`, { method: 'PUT', body: { key } });
      mutate<LookupKeyStatus>(KEY, () => next);
      toast(key ? 'Key saved.' : 'Key removed.');
      return true;
    } catch (error) {
      toast(error instanceof ApiError && error.status === 400 ? 'That does not look like a Gemini API key.' : 'The key could not be saved.');
      return false;
    }
  };
  if (!status) return <p className="muted">Loading…</p>;
  const shared = status.shared;
  return <div className="lk">
    <p>Select a word in a transcript and press <strong>Look up</strong> to see what it means in that line, in Vietnamese.
      Lookups run on Google Gemini and need an API key: your own, or a shared one {isOwner ? 'you add for everyone' : 'the owner adds'}.</p>
    <p className="lk-state">{status.own ? 'You use your own key.' : shared.set ? 'You use the shared key.' : 'There is no key yet, so Look up is off.'}</p>

    <KeyField label="Your own key" last4={status.own} onSave={(key) => save('own', key)}
      hint="Optional. Your lookups then use your own free quota instead of the shared one." />
    {isOwner ? <KeyField label="Shared key, for everyone without their own" last4={shared.from === 'app' ? shared.last4 : null}
      onSave={(key) => save('shared', key)}
      hint={shared.from === 'env' ? `The server’s environment file has one (…${shared.last4}); a key saved here replaces it.` : undefined} /> : null}

    <details className="lk-guide">
      <summary>How to get a free key (about 2 minutes)</summary>
      <ol>
        <li>Open <a href={AI_STUDIO} target="_blank" rel="noopener noreferrer">Google AI Studio</a> and sign in with your Google account.</li>
        <li>Accept the terms if it asks.</li>
        <li>Press <strong>Get API key</strong>, then <strong>Create API key</strong>. If it asks for a project, let it create one.</li>
        <li>Copy the key it shows (a long code, usually starting with <code>AIza</code>).</li>
        <li>Paste it in <strong>Your own key</strong> above and press <strong>Save</strong>.</li>
      </ol>
      <p className="muted">It is free and needs no card. On the free tier Google may use what is sent (the word and its
        transcript line) to improve its products. Keep your key to yourself: anyone with it can use your quota.</p>
    </details>
  </div>;
}

function KeyField({ label, last4, hint, onSave }: {
  label: string;
  last4: string | null;
  hint?: string;
  onSave: (key: string | null) => Promise<boolean>;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (key: string | null) => {
    setBusy(true);
    if (await onSave(key)) setValue('');
    setBusy(false);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (value.trim()) void run(value.trim());
  };
  return <form className="lk-field" onSubmit={submit}>
    <label className="field"><span>{label}{last4 ? <span className="muted"> · saved, ends in {last4}</span> : null}</span>
      <input type="password" autoComplete="off" spellCheck={false} placeholder={last4 ? 'Paste a new key to replace it' : 'Paste the key'}
        value={value} onChange={(e) => setValue(e.target.value)} /></label>
    {hint ? <p className="muted lk-hint">{hint}</p> : null}
    <div className="ppl-acc">
      {last4 ? <button type="button" className="btn" disabled={busy} onClick={() => void run(null)}>Remove</button> : null}
      <button type="submit" className="btn btn-primary" disabled={busy || !value.trim()}>Save</button>
    </div>
  </form>;
}
