# famdash

Minimal, always-on family week calendar dashboard (for a tablet/kiosk). Reads a published Outlook.com ICS feed and shows the current week. See `README.md` for user-facing setup.

## Stack

- Node >= 20, plain `http` server in `server.js` (no framework), single dependency: `node-ical`.
- Frontend is static vanilla HTML/CSS/JS in `public/` (`index.html`, `app.js`, `style.css`), no build step.
- Deployed with Docker (`Dockerfile`, `docker-compose.yml`), image `node:22-alpine`, runs as `node` user.

## Commands

- `npm install`
- `npm start` — run server (needs `ICS_URL` env)
- `npm run dev` — runs against `test/sample.ics` via `ICS_URL=file:test/sample.ics`
- `docker compose up -d --build` — production run, reads `.env`

## Architecture

- `server.js` fetches the ICS on start and every `REFRESH_MINUTES`, keeps it in an in-memory `cache` (`events`, `fetchedAt`, `error`). On failure the last good data is kept and the error is surfaced.
- Events are expanded (recurrences etc.) server-side; week/day math uses `"YYYY-MM-DD"` keys in the configured `TZ` (`dayKey`, `addDays`, `weekStartKey`, `isoWeek`).
- Routes: `GET /api/week` (week data for the UI), `GET /healthz` (last fetch time + error), everything else serves files from `public/`.
- `ICS_URL` supports `https:`, `webcal:` and `file:` (local path) schemes.

## Config (env)

`ICS_URL`, `TZ` (IANA, default UTC), `WEEK_START` (`monday`|`sunday`), `REFRESH_MINUTES` (default 10), `PORT` (default 3000). See `.env.example`.

## Conventions and gotchas

- The ICS URL is a secret: it must stay server-side and never be sent to the browser or logged. `.env` is gitignored; don't commit it or paste its contents.
- No auth on the page — intended to be LAN-only or behind an authenticated reverse proxy.
- Keep it minimal: avoid adding dependencies or a frontend build step without a good reason.
- Dockerfile copies only `package.json`, `server.js` and `public/`; new runtime files must be added there.

## Git workflow

- Branch: `main`. Commit identity is set repo-locally (not global).
- Commit after each logical change, with a descriptive subject (imperative, <= 72 chars) and a body explaining *why*. Commit messages end with the Co-Authored-By line.
- Add clear comments in code that explain intent, not just what the line does. Match the existing comment style in `server.js`.
- Never commit `.env` (gitignored). Check `git status` before committing.
- Remote: `origin` = git@github.com:johnhenriksson/famdash.git (SSH). Key: `~/.ssh/id_ed25519_github` (no passphrase), wired up via a `Host github.com` entry in `~/.ssh/config`. `gh` 2.103.3 is installed at `~/.local/bin/gh` (manual install, no Homebrew; Intel Mac). Don't push without being asked.
- Update the progress log below with each meaningful change.

## Status / progress log

Keep this section updated as work proceeds (newest first).

- 2026-10-29: Installed `gh` to `~/.local/bin`; login pending (user runs `gh auth login`).
- 2026-10-29: Initialized git on `main`, first commit made; `origin` added over SSH with a dedicated key (public key must be added to GitHub; first push pending).
- 2026-10-29: Initial scaffold in place (server, static UI, Docker, sample ICS). CLAUDE.md created.
