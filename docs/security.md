# Security

Reelnote runs on the owner's PC and is reached over the home Wi-Fi (plain HTTP) and Tailscale
(HTTPS through Tailscale Serve, which proxies to `127.0.0.1`). The network side (Windows firewall
rule for the port, Tailscale policy and Serve) is set up outside this repo; these are the rules
the code keeps.

## Identity

- Email + password is the only identity, the owner's included. The server never reads Tailscale
  identity headers (`Tailscale-User-*`, `Tailscale-App-Capabilities`: anyone on the LAN can send
  them), never trusts the client IP, and has no route that skips sign-in for localhost. ESLint
  fails on a literal naming a Tailscale identity header.
- Passwords: scrypt (N=2^15, r=8, p=1, 16-byte salt, 64-byte key), parameters stored in the hash;
  10 to 256 characters. Set from the CLI's hidden prompt or `PUT /api/auth/password`, never from
  argv or the environment.
- Sessions: a random 32-byte token in the `reelnote_session` cookie; the DB keeps only its SHA-256.
  30 days, extended when used (at most once an hour). With "Keep me signed in" off at sign-in the
  cookie has no Max-Age (it ends with the browser), renewals included; the session row still expires
  after 30 days. The owner's installed window stays signed in through this cookie: there is no
  localhost bypass. A password change ends the user's other
  sessions; disabling a user ends all of theirs.
- Cookie: `HttpOnly; SameSite=Lax; Path=/`, plus `Secure` only when the request is HTTPS (directly,
  or `X-Forwarded-Proto: https` from a loopback peer). A Secure cookie set over the LAN's plain HTTP
  would be dropped.
- Sign-in throttling is keyed on the email: 5 failures in 15 minutes lock that email for 15
  minutes; all sign-ins together are capped at 30 a minute. An unknown email costs the same scrypt
  time as a known one, and gets the same answer.

## Requests

- `server/src/auth/auth-hook.ts` runs on every request. Everything under `/api/` and `/images/`
  needs a session, except `POST /api/auth/login` and `GET /api/health`. The route-table test walks
  every registered route and expects 401 without a session.
- Cross-site writes: every non-GET request must carry `X-Reelnote-Request: 1`, and its `Origin`, when
  present, must be the request's own origin (`scheme://host`, with `X-Forwarded-Proto/Host`
  believed only from a loopback peer) or listed in `REELNOTE_ALLOWED_ORIGINS`. No CORS headers are
  ever sent.
- Files: images are served only by name (`<uuid>.<ext>`) and only when a stored row names them;
  videos only by page-video id, resolved inside the library root with no links on the way. File
  responses are `Cross-Origin-Resource-Policy: same-origin`.

## The web UI

- CSP (`server/src/web/security-headers.ts`) is unchanged: `default-src 'self'`, images also `data:`
  and `blob:`, media also `blob:`. The UI has no inline script and needs no `'unsafe-inline'` style:
  React sets styles through the CSSOM (`element.style`), which `style-src` allows, and Tiptap's own
  `<style>` injection is turned off (`injectCSS: false`; its few rules are in `notebook.css`).
  Rendered markdown is sanitized (DOMPurify) with images, `style` tags and attributes removed.
- Every write sends `X-Reelnote-Request: 1` (`web/src/lib/api.ts`); URLs are relative.
- Nothing needs a secure context: frame capture uploads a canvas PNG (no clipboard), Copy on People
  and access falls back to selecting the text over plain HTTP, and there is no service worker.
- What a viewer may see or change is decided on the server; the UI only hides what it would refuse.

## Access

See `architecture.md`, "Users and access". Every learning route checks the signed-in user against
the item before acting, and before reading an upload's body. Images and avatars are served only to
users who can see the block or source that names them.

## Outbound calls

The server calls out to one service only: Google's Gemini API, for word lookup, and only when a signed-in
user who can read the video presses Look up on a selection. What is sent is the selection, its transcript
line and the lines before and after it, read from the video on the server; for the follow-up chat (Ask more),
also the questions the user types and the answers so far, which the client sends back each time.
Answers are stored and reused, so a selection in a line is sent once. Keys are set in the app (each user's
own; the shared one by the owner only) and stored unencrypted in the database, so backups hold them (the
owner's choice); `REELNOTE_GEMINI_API_KEY` is the fallback shared key. A key goes in the `x-goog-api-key`
header, never in a URL or a log line; no response ever carries one, only its last four characters (the
shared key's to the owner only). Calls are rate limited per user and in all (`architecture.md`, "Word lookup"). On
Google's free tier Google may use what is sent to improve its products: the owner chose this; a key on a
billed project avoids it. With no key set nothing is ever sent.

## Binding

`REELNOTE_HOST` defaults to `127.0.0.1`. `0.0.0.0` (LAN and Tailscale) is for the running server
once an owner account exists; the firewall rule scopes the port to the local subnet.
