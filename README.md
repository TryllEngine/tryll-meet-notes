# Tryll Meet Notes

Calendar-driven meeting-notes automation. It watches Google Calendar, sends a
bot into each Google Meet call, transcribes the conversation **with speaker
names**, generates structured notes with **Claude**, saves them as a native
**Google Doc** on Google Drive, and emails a branded summary card to the
company's participants.

Everything runs locally in Docker on a workstation — no dedicated 24/7 server
required. The stack comes alive when Docker is started and processes meetings on
its own.

```
Google Calendar ──▶ tryll-runner (orchestrator, tick every 30s)
                        │  1. dispatch a bot 5 min before start
                        ▼
                    Vexa (self-hosted) ──▶ joins Google Meet, records audio,
                        │                   captures speaker names
                        ▼
                    Whisper (self-hosted, GPU) ──▶ transcript "Name: line"
                        │
                        ▼
                    Claude (CLI on subscription, or API) ──▶ notes JSON
                        │
                        ▼
                    Google Drive (native Google Doc) + Gmail (summary card)
```

## How it works

The orchestrator (`src/core.ts`) runs one tick every 30 seconds, in three steps:

1. **Dispatch** — reads upcoming meetings from Google Calendar and sends a Vexa
   bot **5 minutes before** each meeting starts. At most `MAX_CONCURRENT_BOTS`
   (default 3) run at once; extra meetings wait for a free slot.
2. **Collect** — watches every active bot. While the transcript keeps growing the
   meeting is live (longer-than-scheduled calls are fine). When it stalls / ends /
   the bot is kicked, the transcript is captured. If the bot is stuck or the
   meeting platform falsely reports it as still running, the runner force-stops it
   so a slot is **always** freed (no "ghost" bots).
3. **Notes** — turns each transcript into notes with Claude, uploads them as a
   native Google Doc, and emails the summary card. This is idempotent and
   retried until it succeeds: **exactly one document and one email per meeting**,
   and it survives a restart.

### Bot lifecycle

- Joins **5 min before** the scheduled start. Using a company Google account it
  is **auto-admitted** (no waiting room).
- **Nobody joins within 10 min** → leaves, no transcript, no notes, frees the slot.
- **Everyone leaves** and the bot is alone for **3 min** → leaves and produces notes.
- **Kicked** → leaves immediately, frees the slot, writes notes from whatever was
  captured, and does not rejoin that meeting.
- **Startup-skip** — because there is no 24/7 server, if the runner wakes up
  (Docker just started) and a meeting is **already running for more than
  `STARTUP_SKIP_MIN`** (default 5), it is skipped — the bot won't join near the end.

### Notes & email

- Notes body is written in the **meeting's language**; the file name and the
  email TL;DR are always in **English**.
- Sections: TL;DR, decisions, action items (`owner → task → due`), open
  questions, a discussion summary, and the full transcript.
- Saved to Drive as a native Google Doc:
  `Root / <series folder> / <Title> - <YYYY-MM-DD>`.
- The email is a branded HTML card (logo, "Open meeting notes" button, English
  TL;DR, signature). It is sent **only to attendees on the company domain** —
  external guests are never emailed.

### State

Processed meetings are tracked in a small persistent store
(`/data/store.json` on a Docker volume, written atomically). This survives
restarts, so a bot never re-joins a meeting it already handled. Upstash Redis is
used instead if its environment variables are set.

## Components

| Container | Role |
|-----------|------|
| `tryll-runner` | Orchestrator (this repo): calendar → bot → transcript → notes → Drive → email |
| `vexa-lite` + `vexa-postgres` | [Vexa](https://github.com/Vexa-ai/vexa) self-hosted meeting bot (joins Meet, records) |
| `transcription-lb` + workers | Self-hosted Whisper (`large-v3-turbo`, GPU) |

The runner is a small TypeScript app run directly with `tsx` (no build step):

- `src/calendar.ts` — Google Calendar polling, Meet-code dedup, attendees
- `src/vexa.ts` — Vexa REST client (request bot, status, transcript, stop) + leave timeouts
- `src/core.ts` — the orchestrator (dispatch / collect / notes)
- `src/notes.ts`, `src/notes-cli.ts` — notes generation (Claude API / Claude CLI)
- `src/docx.ts`, `src/drive.ts` — document build + Drive upload (Google Doc)
- `src/email.ts`, `src/finalize.ts` — summary email + idempotent finalize
- `src/store.ts` — persistent state

Vexa runs with small local patches (`scripts/patch_*`): authenticated join under
a domain profile, an avatar camera, and robust leave detection.

## Configuration

Copy `.env.example` to `.env` and fill it in. Key variables:

| Variable | Purpose |
|----------|---------|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN` | Google OAuth (Calendar read, Drive, Gmail send) |
| `GOOGLE_CALENDAR_IDS` | Calendars to watch (comma-separated; default `primary`) |
| `VEXA_BASE_URL` / `VEXA_API_KEY` | Vexa endpoint and key |
| `BOT_AUTHENTICATED` / `BOT_AVATAR_URL` | Domain auto-admit + bot avatar |
| `NOTES_MODE` | `cli` (Claude Code subscription) or `api` (`ANTHROPIC_API_KEY`) |
| `NOTES_EMAIL` / `NOTES_EMAIL_FROM` / `COMPANY_DOMAIN` | Auto-email of notes |
| `DRIVE_ROOT_FOLDER_ID` | Drive folder for the notes tree |
| `MAX_CONCURRENT_BOTS` / `STARTUP_SKIP_MIN` | Concurrency limit / startup-skip threshold |

Opt a meeting out of recording by adding `[norec]` to its calendar title.

## Run

```bash
docker compose up -d --build      # build & start the runner (restarts with Docker)
docker logs -f tryll-runner       # watch activity
```

The runner attaches to the same Docker network as Vexa and ticks automatically.
For a non-container local run: `npm install && npm run local`.
