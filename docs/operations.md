# Operations

## First setup (once)

All of it in one go: `powershell -ExecutionPolicy Bypass -File scripts\first-run.ps1` (asks the
owner's email, name and password). By hand:

1. `pnpm install` and `pnpm build` in the repo folder.
2. Copy `.env.example` to `.env`. Keep `REELNOTE_HOST=127.0.0.1` until the owner account exists;
   then `0.0.0.0` lets the home network (and Tailscale) reach it.
3. Create the owner account (asks the password twice, hidden):
   `pnpm user create --email <you> --name <name> --role owner`
4. Start it: double-click `scripts\start-reelnote.cmd` (a "Reelnote" window; closing it stops the
   server), or `pnpm start` in a terminal. It does not start by itself when you sign in to Windows
   (owner's choice); `scripts\install-startup-task.ps1` registers a logon task if that changes.
   Desktop icon: `scripts\install-desktop-shortcut.ps1` puts a "Reelnote" shortcut on the desktop
   that runs `scripts\open-reelnote.ps1`: it starts the server (minimized window) when port 3900 does
   not answer, then opens the browser.
5. Open `http://localhost:3900` in Edge or Chrome and sign in with "Keep me signed in" on. Install it
   as an app window: the install icon in the address bar, or the browser menu → Apps → Install
   Reelnote.

## Update the UI

`pnpm build` (builds `web/dist` and the server), then restart Reelnote (close the "Reelnote" window
and run `scripts\start-reelnote.cmd` again): the server lists the UI's files when it starts.

## Friends

In the UI: People and access (the people icon in the rail, owner only). Add a person (name, email, a
generated temporary password, the sources they open and edit), send them the hand-off card yourself;
each source has an Open and an Edit tick, changeable at any time (a new person, and a new source,
start with Open ticked everywhere; Edit lets them change that source and every note on it);
reset a password; remove a person (they can no longer sign in;
Undo restores them). `REELNOTE_TAILSCALE_URL` in `.env` makes the hand-off name the Tailscale
address; `first-run.ps1` sets it, and `REELNOTE_ALLOWED_ORIGINS`, from `tailscale status` when
Tailscale is signed in. The same from the CLI:

- `pnpm user create --email <e> --name <n> --role friend` (opens every source), then give them the password.
- `pnpm share list`, `pnpm share add <sourceId> --email <e> [--write]`, `pnpm share remove <sourceId> --email <e>`.
- `pnpm user disable --email <e>` signs them out everywhere and blocks sign-in; `enable` undoes it.
- The same is available to the owner over `/api/admin/*`.

The network side is set up outside this repo: a Windows firewall rule for TCP 3900 on the local
subnet, and Tailscale Serve (`https://<pc>.<tailnet>.ts.net` → `http://127.0.0.1:3900`) with friends
limited to port 443.

## Notes made on this PC

Claude writes study notes from a video's transcript on this PC and adds them as the owner's, without
the web UI (the video's folder must be imported in Reelnote first, so its page exists):

- `pnpm import-videos <source id or name> <folder> [<file>...] [--one-page] [--dry-run]`: the import
  dialog's folder import from this PC, same rules (the folder is relative to the video library; files a
  page already has are skipped). One page per video, or only the named files; `--one-page` puts them all
  on one page.

- `pnpm notes add <notes.json>... [--dry-run]`: one JSON per video,
  `{"key": "<id in [brackets] in the file name>" | "video": "<path or file name>" | "pageId": n,
  "summary": "<markdown>", "segments": [{"t": <second>, "body": "<markdown>"}]}`. The summary
  becomes a summary block; each segment a note stamped at its second. Times must increase and stay
  within the video.
- `pnpm notes insights <source id or name> <insights.md> [--dry-run]`: each section starting
  `=== <category>` becomes a standalone insight in that category (created if missing).

Both refuse a page or source that already has the owner's notes, so a re-run adds nothing twice.
They write the DB directly, next to the running server (SQLite handles both).

## Data, logs, backups

- Everything is under `REELNOTE_DATA_DIR` (default `E:\ReelnoteData`): `reelnote.db`, `images/`,
  `logs/` (daily files, 14 kept), `backups/`.
- The server writes a backup when it starts and then once a day: `backups/<YYYY-MM-DD>/reelnote.db`
  (14 days kept) plus `backups/images/`, a mirror that only grows (stored images never change, so
  every DB backup finds its images there). `pnpm cli backup` writes today's now.

### Restore

1. Stop the server (close the "Reelnote" window, or stop `pnpm start`).
2. Move `reelnote.db`, `reelnote.db-wal` and `reelnote.db-shm` out of `REELNOTE_DATA_DIR`.
3. Copy `backups/<day>/reelnote.db` to `REELNOTE_DATA_DIR\reelnote.db`.
4. Copy any file in `backups/images/` that `images/` lacks back into `images/`.
5. Start the server.

## Commands

| Command | Does |
|---|---|
| `pnpm start` | Run the built server |
| `pnpm dev` | Run from source with reload |
| `pnpm user …` | Accounts: create, password, disable, enable, list |
| `pnpm share …` | Which friends open which source |
| `pnpm import-videos …` | Add a library folder's videos to a source, from this PC |
| `pnpm notes …` | Add notes made on this PC as the owner's |
| `pnpm cli backup` | Today's backup now |
| `pnpm cli migrate` | Apply DB migrations (the server does this at start) |
