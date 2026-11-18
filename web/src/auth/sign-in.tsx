import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError, NetworkError } from '../lib/api';
import type { Me } from '../lib/types';
import { Icon } from '../shell/icons';

/** Which address this is, in words (design-spec §5.1): this PC, the home Wi-Fi (not encrypted), or Tailscale. */
export function connectionKind(): 'pc' | 'tailscale' | 'lan' | 'other' {
  const host = location.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return 'pc';
  if (location.protocol === 'https:' && host.endsWith('.ts.net')) return 'tailscale';
  if (location.protocol === 'http:') return 'lan';
  return 'other';
}

function ConnectionLine() {
  const kind = connectionKind();
  const address = <span className="mono">{location.origin}</span>;
  if (kind === 'pc') return <p className="lg-conn"><Icon name="home" /><span>{address} · This PC.</span></p>;
  if (kind === 'tailscale') return <p className="lg-conn lg-safe"><Icon name="lock" /><span>{address} · Encrypted by Tailscale.</span></p>;
  if (kind === 'lan') return <p className="lg-conn"><Icon name="wifi" /><span>{address} · Home Wi-Fi. This connection is not encrypted, so use it only at home. Away from home, use the Tailscale address.</span></p>;
  return <p className="lg-conn"><Icon name="lock" /><span>{address}</span></p>;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SignIn({ onSignedIn }: { onSignedIn: (me: Me) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [keep, setKeep] = useState(true);
  const [error, setError] = useState<{ text: string; field: 'email' | 'password' } | null>(null);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passRef = useRef<HTMLInputElement>(null);

  useEffect(() => { emailRef.current?.focus(); }, []);
  useEffect(() => {
    if (error) (error.field === 'email' ? emailRef : passRef).current?.focus();
  }, [error]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!EMAIL.test(email.trim())) return setError({ text: 'Enter the email address the owner set up for you.', field: 'email' });
    if (!password) return setError({ text: 'Enter your password.', field: 'password' });
    setBusy(true);
    try {
      await api('/auth/login', { method: 'POST', body: { email: email.trim(), password, remember: keep } });
      onSignedIn(await api<Me>('/auth/me'));
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 429) {
        const minutes = /(\d+) min/.exec(failure.message)?.[1];
        setError({ text: `Too many attempts. Wait ${minutes ? `${minutes} minute${minutes === '1' ? '' : 's'}` : 'a while'}, then try again.`, field: 'password' });
      } else if (failure instanceof ApiError && failure.status === 401) {
        setError({ text: 'Email or password is incorrect.', field: 'password' });
      } else if (failure instanceof NetworkError) {
        setError({ text: 'Can’t reach Reelnote. Check that the PC is on, then try again.', field: 'email' });
      } else {
        setError({ text: failure instanceof Error ? failure.message : 'Sign-in failed.', field: 'password' });
      }
      setBusy(false);
    }
  };

  return <main className="login">
    <div className="login-card">
      <h1 className="login-brand">Reelnote</h1>
      <p className="login-sub">Sign in to your study desk.</p>
      <form className="login-form" noValidate onSubmit={submit}>
        <label className="field"><span>Email</span>
          <input ref={emailRef} type="email" autoComplete="username" spellCheck={false} value={email}
            aria-invalid={error?.field === 'email' || undefined} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="field"><span>Password</span>
          <span className="field-row">
            <input ref={passRef} type={show ? 'text' : 'password'} autoComplete="current-password" value={password}
              aria-invalid={error?.field === 'password' || undefined} onChange={(e) => setPassword(e.target.value)} />
            <button type="button" className="btn" aria-pressed={show} onClick={() => { setShow(!show); passRef.current?.focus(); }}>{show ? 'Hide' : 'Show'}</button>
          </span></label>
        {error ? <div className="lg-err" role="alert">{error.text}</div> : null}
        <label className="check"><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> Keep me signed in on this device</label>
        <button className="btn btn-primary lg-submit" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      <p className="lg-help">Forgot your password? Ask the owner to reset it.</p>
    </div>
    <ConnectionLine />
  </main>;
}
