# famdash

A minimal, always-on family week calendar. It reads a published Outlook.com (live.com) calendar over ICS and shows the current week.

## Setup

1. **Publish the calendar.** In Outlook.com go to Settings > Calendar > Shared calendars > Publish a calendar. Pick the family calendar, set permission to "Can view all details", click Publish, and copy the **ICS** link. Treat the link as a secret.
2. **Configure.** `cp .env.example .env`, then set `ICS_URL` and `TZ`.
3. **Run.** `docker compose up -d --build`
4. **Open** `http://<vm-ip>:3000` on the tablet and use the browser's fullscreen/kiosk mode.

Outlook refreshes published feeds on its own schedule, so changes can take from a few minutes up to an hour to show up.

## Notes

- The ICS URL stays on the server and is never sent to the browser.
- If a refresh fails, the last good data keeps showing and the status label in the header turns amber.
- Keep the service LAN-only (or behind your reverse proxy with auth). The page shows family events and has no login.
- `GET /healthz` reports the last fetch time and error.

## Local development (needs Node 20+)

```
npm install
ICS_URL=file:test/sample.ics TZ=Europe/Stockholm npm start
```

Then open <http://localhost:3000> or `curl localhost:3000/api/week`.
