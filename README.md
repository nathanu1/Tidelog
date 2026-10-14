# LogDataTrack

Log what you do. Watch it become living art.

LogDataTrack is a small self-hosted web app: every activity you log (from the UI, a timer, the terminal, a phone shortcut, a git hook, anything that can POST JSON) lands in **Postgres**, and the front end turns the data into an animated, layered waveform that keeps breathing while you work. Metrics fluctuate live, the artwork moves with them, and any frame can be saved back to the database and re-rendered later.

![LogDataTrack artwork](docs/hero.jpg)

![LogDataTrack with metrics](docs/app.jpg)

## What it does

- **Quick logging** with a shorthand line: `45m deep work on the renderer @work #focus !4 ~5` (duration · category · tags · intensity · mood). Press `L`, type, Enter.
- **Timers**: `T` to start one, `T` again to stop it and log the elapsed time.
- **Live metrics** that update the moment data changes: logged time, focus (duration-weighted intensity), balance (how evenly your time is spread), streak, mood, peak hour, plus a fluctuating *Signal* reading taken straight from the animation.
- **Art from data**: one ribbon per category, mirrored around a centre axis. Height along the timeline is how much of each time slice you filled, ripple speed is intensity, particle density is your energy over the last three hours, tempo is how much you logged today, background warmth is your average mood. A seed fixes the noise field so pieces are reproducible.
- **Gallery**: save a piece (`S`) with its seed, envelopes and a thumbnail; reopen it and it animates again. Download any piece as a 1920×1200 PNG.
- **Real time everywhere**: the server pushes Server-Sent Events, so a log from the terminal shows up in every open browser instantly.
- **Workflow hooks**: a CLI (`logtrack`), curl examples, a git post-commit hook, iOS Shortcut / Raycast recipes, CSV and JSON export.
- **Postgres** schema with migrations, overlap-weighted time bucketing in SQL, and an optional API token for write protection.

## Quick start

Requirements: Node 20+ and PostgreSQL 14+ (or Docker).

### With Docker

```bash
git clone https://github.com/nathanu1/LogDataTrack.git
cd LogDataTrack
docker compose up --build
# open http://localhost:3000
```

Migrations run automatically on boot. To add two weeks of sample data so the art has something to say:

```bash
docker compose exec app node scripts/seed.js
```

### Without Docker

```bash
git clone https://github.com/nathanu1/LogDataTrack.git
cd LogDataTrack
npm install
cp .env.example .env            # set DATABASE_URL if yours differs
createdb logtrack               # or: psql -c "CREATE DATABASE logtrack"
npm run migrate
npm run seed                    # optional sample data
npm start                       # http://localhost:3000
```

`npm run dev` restarts the server on file changes. `npm test` runs the unit tests.

## Logging from anywhere

The shorthand works everywhere: `45m` / `1h30m` duration · `@work` category (slug or prefix, inferred from keywords when omitted) · `#tag` · `!1-5` intensity · `~1-5` mood.

**In the browser**: `L` opens the drawer, Enter logs, `Esc` closes. `T` starts/stops a timer, `S` saves the piece, `G` opens the gallery, `D` downloads a PNG, `R` rolls a new seed, `F` hides the UI, `1` `2` `3` switch between 24h / 7d / 30d.

**From the terminal**:

```bash
npm link                               # once; installs the `logtrack` command
logtrack "45m deep work @work #focus !4 ~5"
logtrack start "Writing the spec @work #docs"
logtrack stop ~4
logtrack today
logtrack art 7d                        # the envelopes, drawn in your terminal
```

Set `LOGTRACK_URL` (default `http://localhost:3000`) and `LOGTRACK_TOKEN` if the server has `API_TOKEN` set.

**From anything with HTTP**:

```bash
curl -X POST http://localhost:3000/api/activities/quick \
  -H 'content-type: application/json' \
  -d '{"text":"30m morning run @exercise #outdoors ~5","source":"curl"}'
```

**From git**: copy `examples/git-post-commit` into `.git/hooks/post-commit`; every commit becomes a Work entry and the artwork reacts.

**From your phone**: see `examples/shortcuts.md` for iOS Shortcuts, Android and launcher recipes.

![Log drawer](docs/log-drawer.jpg)

## How the art is made

| Data | Visual |
| --- | --- |
| Category | One ribbon per category, in the category's colour, mirrored around the axis |
| Minutes per time slice (overlap-weighted in SQL) | Ribbon height along the timeline, Gaussian-smoothed and Catmull-Rom interpolated |
| Intensity per slice | Amplitude of the fast ripple on that part of the ribbon |
| Energy (duration × intensity over the last 3 h) | Particle spawn rate and count |
| Entries in the last 24 h | Tempo of the animation |
| Average mood | Background warmth (cool blue-grey → warm brown) |
| Seed (hash of the data state) | Noise field for breathing, ripple, halo dots and sparkles |

Everything is rendered with Canvas 2D at device pixel ratio: fills with a lit gradient, a wireframe mesh and contour lines clipped inside each ribbon, lit edges, dotted columns rising from the crests, drifting particles, and a seeded field of twinkling specks. Toggle a category in the legend to solo the others.

## Metrics

| Metric | Meaning |
| --- | --- |
| Signal | Live mean amplitude of the artwork, sampled 8× per second |
| Logged | Minutes and entries in the selected window, plus today's total |
| Focus | Σ(duration × intensity) / Σ(duration × 5), 0–100 |
| Balance | Normalised Shannon entropy of minutes per category, 0–100 |
| Streak | Consecutive days with at least one entry (today, or yesterday if today is still empty) |
| Mood | Average mood in the window |
| Peak hour | Hour of day with the most logged minutes (in your time zone) |

Each tile carries a sparkline of the window: hourly for 24h, daily for 7d and 30d.

## API

All endpoints return JSON. Reads are always open; when `API_TOKEN` is set, writes (POST/PATCH/DELETE) require `Authorization: Bearer <token>` (or an `x-api-token` header, or `?token=`).

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Liveness + DB clock |
| GET | `/api/events` | Server-Sent Events: `activity.created/updated/deleted`, `timer.started/stopped`, `artwork.created/deleted`, `categories.changed` |
| GET | `/api/activities?limit&offset&from&to&category&tag&q` | List entries |
| POST | `/api/activities` | Create: `{title, category, duration_min, intensity, mood, tags, note, started_at, source}` |
| POST | `/api/activities/quick` | Create from shorthand: `{text, source}` |
| GET | `/api/activities/parse?text=` | Preview how a line parses |
| GET/PATCH/DELETE | `/api/activities/:id` | Read, update, delete |
| GET/POST | `/api/categories` | List, create (`{name, color, slug, sort_order}`) |
| PATCH/DELETE | `/api/categories/:slug` | Rename/recolour, delete (only when unused) |
| GET | `/api/metrics?range=24h\|7d\|30d&tz=Area/City` | Aggregates, series, streak, recent entries |
| GET | `/api/art?range=24h\|7d\|30d` | Per-category envelopes, intensity, seed, energy, tempo, mood |
| GET | `/api/timers/active` | The running timer, if any |
| POST | `/api/timers/start` | `{text}` or `{title, category, tags, intensity}` |
| POST | `/api/timers/stop` | Logs the elapsed time; optional `{mood, note, tags, title}` |
| DELETE | `/api/timers/active` | Cancel without logging |
| GET/POST | `/api/artworks` | Gallery list, save a piece (`{title, seed, range, params, thumbnail}`) |
| GET/PATCH/DELETE | `/api/artworks/:id` | Full params for re-rendering, rename, delete |
| GET | `/api/export.csv`, `/api/export.json` | Everything, for your own analysis |

Default behaviour when `started_at` is omitted: the entry *just finished*, so it starts `duration_min` minutes ago. Pass `started_at` to backdate.

## Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `postgres://logtrack:logtrack@localhost:5432/logtrack` | Any Postgres 14+ |
| `PGSSL` | unset | Set to `require` for hosted Postgres (Neon, Supabase, Railway, RDS) |
| `PORT` | `3000` | |
| `API_TOKEN` | unset | Protects write endpoints when set; the UI asks for it once and remembers it |
| `AUTO_MIGRATE` | `true` | Apply pending migrations on boot |

A `.env` file in the project root is read if present. Values already in the environment win.

## Database

```
categories   slug, name, color, sort_order
activities   category_id, title, note, duration_min, intensity (1–5), mood (1–5), tags[], source, started_at
timers       category_id, title, tags[], intensity, started_at, stopped_at, activity_id   (one active at a time)
artworks     title, seed, range_key, params (jsonb), thumbnail
```

Migrations live in `db/migrations/*.sql`, are applied in order and tracked in `schema_migrations`. Add a new file to evolve the schema; `npm run migrate` (or boot) applies it. `npm run db:reset` drops everything and re-seeds (refuses in production without `--force`).

The envelopes behind the art come from one query: a `generate_series` of time buckets joined against activities on interval overlap, summing the overlapping minutes (and intensity-weighted minutes) per bucket and category.

## Project layout

```
server/          Express app, routes, SSE hub, migrations runner
  routes/        activities, categories, metrics, art, timers, artworks, export
  lib/           validation, metrics maths, envelope builder, activity service
shared/          code used by both server and browser (quick parser, PRNG)
public/          static front end: index.html, css/, js/ (app.js UI, art.js renderer, noise.js)
db/migrations/   SQL migrations
scripts/         migrate.js, seed.js
bin/logtrack.js  CLI
examples/        curl, git hook, phone/launcher recipes
test/            node:test unit tests
```

## Deploying

Any host that runs Node and can reach a Postgres works (Railway, Render, Fly.io, a VPS with the Docker Compose file). Set `DATABASE_URL`, `PGSSL=require` for managed databases, and an `API_TOKEN` if the server is reachable from the internet. The app is a single process; migrations run on boot and are safe to run from several replicas.

## License

MIT
