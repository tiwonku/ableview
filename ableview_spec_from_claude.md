# AbleView (v2026) — Build Specification

> Repo name: `ableview`. This document is written to be handed to a coding agent as the
> seed for a new repository. A human-facing summary is in the TL;DR immediately below;
> the build detail follows from §0 onward.

---

## TL;DR (for humans)

**AbleView is a behind-the-scenes "now playing" board for a live show.** It watches the
master Ableton session, figures out which song/section is currently playing, looks that up
in a shared Google Sheet of cue notes, and shows each operator — the band, the visuals op,
the lighting op — exactly the info they need on their own screen, updating live as the set
moves.

Think of it as the Ableton-based replacement for a CDJ / ShowKontrol-style rig, scoped to
one job: keep the whole crew reading from the same page, automatically.

**The four moving parts:**

- **Ableton listener** — sees which clip is playing. Read-only; it cannot change or disturb
  the session.
- **Google Sheet** — the cue database: one row per song/section, columns of notes for each
  role. This is the single source of truth the crew edits.
- **Matcher** — links the playing clip's name to the right row, tolerant of small naming
  differences.
- **Operator views** — simple web pages (one per role) showing that row's info, each laid
  out for its audience.

**What matters most:**

- **Safe** — it only reads from Ableton and can never write to or destabilize the
  show-critical session.
- **Unattended** — runs on a small dedicated computer you plug in and power on; it
  auto-starts and self-heals, no babysitting.
- **Resilient** — if the internet or Google goes down mid-show, the operator screens keep
  working from a local copy of the sheet.
- **Simple to use** — operators just open a web page on any laptop, tablet, or monitor.

**For testing,** AbleView ships with a **simulation mode** so the whole system can be built,
demoed, and rehearsed without a live Ableton rig on the network.

**Not in this release (planned later):** automatically sending cues out to lighting consoles
as OSC, and showing a waveform with a playhead for the playing clip.

---

## 0. How to use this spec (agent instructions)

- Treat the **MUST / MUST NOT** items in §4 as hard constraints. Several protect a
  show-critical Ableton session and are non-negotiable.
- Build in the milestone order in §10. Each milestone is independently testable.
- Keep dependencies minimal and boring. This runs unattended on show nights.
- Everything operational is **config-driven** (§8). No hardcoded IPs, ports, sheet IDs,
  column names, or view layouts.
- Deliver the **simulation module** (§7) early so the rest can be built without Ableton.
- Remaining open decisions are in §12; where a default is given, implement it but keep it
  configurable.

---

## 1. Purpose

A headless service that listens to a live Ableton session, determines the
**currently-playing clip** (the active "cue"), looks that clip up against a
**Google Sheet** of cue data using **fuzzy string matching**, and pushes the matched row to
**1–4 role-specific operator dashboards** (e.g. band, visuals, lighting) rendered in the
browser and updated in real time.

It replaces the need for a commercial tool like ShowKontrol for an Ableton-sourced
(non-CDJ) rig, scoped to the "now-playing → lookup → operator display" job.

---

## 2. Scope

### In scope (v2026)

1. Ableton listener that reports **names of currently-playing clips** (critical) and
   **tempo / bar** info (secondary).
2. Google Sheets integration with **offline cache** so operator views keep working if
   Google or the network is unavailable.
3. **Fuzzy match** of the active clip name to a sheet row.
4. **1–4 operator views**, each showing a different subset/layout of the matched row.
5. **Simulation module** to run and test the whole system without a live Ableton session.
6. Headless operation on dedicated hardware: **auto-start on power-up**, auto-restart on
   crash, remotely manageable (SSH + an admin web page).

### Explicitly OUT of scope (do NOT build; leave clean extension points)

- Rebroadcasting clip triggers as outbound OSC to other systems (GrandMA3, etc.).
- Waveform display with a playhead for the playing clip.
- Any **write-back to Ableton** (setting tempo, firing clips, etc.). Not now, not ever by
  default — see §4 NFR-1.

These are future work. The architecture must not preclude them (see §11), but no code for
them ships in v2026.

---

## 3. Architecture overview

```
  ┌────────────────┐          ┌────────────────┐
  │ Master Ableton │          │  Google Sheet  │
  │ OSC · read-only│          │  cue database  │
  └───────┬────────┘          └───────┬────────┘
          │ clip names + tempo (OSC/UDP)   │ periodic sync (service account)
          ▼                                ▼
  ┌──────────────────────────────────────────────────────────┐
  │ AbleView · headless mini-PC (systemd service)            │
  │                                                          │
  │   OSC listener  ──►  Fuzzy matcher  ──►  View server     │
  │  (playing clips)    (clip → sheet row)   (WebSocket push)│
  │                          ▲                               │
  │                   in-memory sheet + local offline cache  │
  └──────────────────────────────┬───────────────────────────┘
                                  │ WebSocket (LAN)
                                  ▼
                    ┌───────────────────────────┐
                    │ Operator views (1–4)      │
                    │ band · visuals · lighting │
                    │ · admin/status            │
                    └───────────────────────────┘

  (A simulation source can replace the Ableton input for testing — see §7.)
```

Key architectural principles:

- **Two-tier data by criticality.** Clip names are the critical payload; tempo/bar is
  best-effort. The system must degrade gracefully if tempo is missing but MUST NOT degrade
  on clip-name delivery.
- **Sheets is off the hot path.** The full sheet is loaded into memory and refreshed on an
  interval. All matching runs against the in-memory copy, so a clip change never waits on a
  network call.
- **Connectionless-friendly ingest.** The ingest source (AbletonOSC in v2026) pushes over
  UDP; the tool just listens. No fragile bidirectional handshake on the critical path.
- **Ingest is an interface.** The real listener and the simulator (§7) are interchangeable
  sources behind one interface, both emitting the same `NowPlaying` event.

---

## 4. Non-functional requirements (testable)

Language: RFC-2119 (MUST / MUST NOT / SHOULD).

- **NFR-1 — Ableton isolation (critical).** The tool MUST NOT send any message that can
  mutate the Ableton set. Specifically, it MUST NOT emit any AbletonOSC write address
  (`/live/**/set`, `/live/**/fire`, `/live/**/create_*`, `/live/**/delete_*`, or
  tempo/transport writes). The Ableton-facing module SHOULD contain **no code path** that
  constructs a write message (enforce structurally, not just by discipline). A test MUST
  assert the outbound OSC address set is a subset of an allowlist of read/listen addresses.
- **NFR-2 — Stability / auto-start.** MUST run as a system service that starts on boot and
  restarts on crash. MUST recover automatically when Ableton restarts (re-establish
  listeners) and when the network drops (keep serving cached data).
- **NFR-3 — Offline capability.** If Google Sheets is unreachable, operator views MUST keep
  working using the last successful sheet snapshot. The admin/status view MUST show that
  data is stale and when it was last synced.
- **NFR-4 — Latency.** Clip-change → operator-view update SHOULD be < 200 ms on a wired LAN.
  Matching MUST be in-memory (no per-trigger network I/O).
- **NFR-5 — Headless / remote.** No GUI. All settings changeable via config file and/or the
  admin web page; the box is managed over SSH.
- **NFR-6 — View resilience.** Views MUST auto-reconnect their WebSocket and MUST display a
  connection state + last-update timestamp so a tool restart is visually obvious.
- **NFR-7 — Match safety.** A below-threshold match MUST render an explicit "no confident
  match" state. The system MUST NOT silently display a wrong row.
- **NFR-8 — Observability.** MUST write structured logs (match events, syncs, errors) and
  expose a status view (current clip, matched row, confidence, last sync, connected view
  count, cache staleness). When the simulator is active, the status view MUST show a
  persistent "SIMULATION MODE" banner (see §7).

---

## 5. Recommended stack

Default target is **Node.js** (LTS ≥ 20) because it unifies OSC ingest, Google Sheets,
fuzzy matching, WebSocket push, and static serving in one runtime and one language as the
frontend. **Python + FastAPI + `rapidfuzz`** is an equally valid alternative with an
identical architecture — see §12 (OD-2).

Node dependency set (suggested, keep minimal):

| Concern            | Library                          |
|--------------------|----------------------------------|
| OSC (UDP)          | `osc` (osc.js)                   |
| HTTP server        | `fastify` (or `express`)         |
| WebSocket          | `ws`                             |
| Google Sheets      | `googleapis` (service account)   |
| Fuzzy matching     | `fuse.js`                        |
| Structured logging | `pino`                           |
| Secrets loading    | `dotenv`                         |

Frontend: static HTML/CSS/vanilla JS per role + one shared WebSocket client module.
No build step (zero-build = fewer things to break on a show night). A light framework is
acceptable only if it does not introduce a build/watch dependency at runtime.

Offline cache: a single JSON file on disk (`better-sqlite3` is optional if structured
querying is later wanted — not needed for v2026).

---

## 6. Ingest (the Ableton listener)

### v2026: AbletonOSC (read-only)

Use [`AbletonOSC`](https://github.com/ideoforms/AbletonOSC) as a MIDI Remote Script on the
Ableton machine. It exposes the Live Object Model over OSC (listen on 11000, replies on
11001 to the requesting IP). The tool registers listeners on startup and re-registers on
reconnect / on detecting silence.

Relevant addresses (read/listen only):

- Per relevant track, listen for the playing slot changing:
  `/live/track/start_listen/playing_slot_index <track_index>`
- On change, resolve the clip name for that track/slot:
  `/live/clip/get/name <track_index> <clip_index>`
  (or `/live/track/get/clips/name <track_index>`).
- Tempo (secondary): `/live/song/get/tempo` + `/live/song/start_listen/tempo`.
- Beat (secondary): `/live/song/start_listen/beat` (fires each beat with the beat number).

> NOTE: AbletonOSC replies **unicast to the requesting IP** — it does not multicast. For
> v2026 the single AbleView box is the only subscriber, so this is fine. If multiple direct
> subscribers are ever needed, prefer the M4L path below or a fan-out relay.

### Future hardening (NOT v2026): send-only Max for Live device

A purpose-built M4L device that observes the playing clip per track + tempo and
**broadcasts/multicasts** OSC one-way. Advantages: no inbound write surface at all,
IP-independent fan-out, connectionless auto-start stability. It emits the same normalized
clip-name messages, so swapping it in later is a change of source, not an app rewrite. Keep
the ingest module behind the interface (§9) so this swap is trivial.

### Determining the "current cue" — RESOLVED (track strategy)

Multiple clips play at once in Session View, so the tool needs a rule for which clip is the
authoritative lookup key. **v2026 uses the `track` strategy:** the currently-playing clip
on a designated **cue track** is the key. Set `ingest.authoritative.track` to the real cue
track's name (or index). The other strategies remain available in config but are not the
default:

- `track` **(default, confirmed)** — playing clip on the designated cue track.
- `scene` — the currently-triggered scene name.
- `mostRecent` — the most recently (re)triggered clip on any watched track.

The ingest module emits the normalized event in §9.1 regardless of strategy.

---

## 7. Simulation module (test without Ableton)

**Purpose:** build, iterate, demo, and rehearse AbleView with no live Ableton session on the
network. Because ingest sits behind an interface (§9), the simulator is simply an alternate
ingest source that produces the same `NowPlaying` events the real listener would — nothing
downstream is special-cased.

**Modes:**

- `internal` (default sim mode) — feeds `NowPlaying` events straight into the internal event
  bus, bypassing OSC. Fastest for iterating on matching + views.
- `osc` — emits real OSC packets that mimic AbletonOSC's addresses/ports, exercising the
  actual OSC listener path end-to-end. Use this to validate the ingest adapter itself.

**Drivers (where the fake clip names come from):**

- `sheetClipNames` (default) — pull real values from the loaded sheet's `matchColumn` and
  walk/shuffle them, so matches actually resolve. Best for demoing the full chain.
- `scenario` — a JSON scenario file: an ordered list of `{ clipName, holdSeconds }` steps,
  optionally looping. A repeatable scripted set.
- `manual` — fire a specific clip on demand from the admin view (or a small control endpoint
  / CLI). Useful for targeted testing.

**Requirements:**

- MUST be disabled by default (`sim.enabled: false`).
- When enabled, the admin/status view MUST show a persistent, unmistakable
  **"SIMULATION MODE"** banner so sim is never mistaken for live on a show night.
- MUST emit the exact `NowPlaying` contract (§9.1).

Deliver the simulator as part of **M1** so every later milestone can be developed and tested
without Ableton.

Scenario file example (`config/scenarios/demo-set.json`):

```json
{
  "loop": true,
  "steps": [
    { "clipName": "Song A - Intro", "holdSeconds": 8 },
    { "clipName": "Song A - Drop",  "holdSeconds": 12 },
    { "clipName": "Song B - Verse", "holdSeconds": 10 }
  ]
}
```

---

## 8. Configuration

Two-layer config: **`.env` for secrets**, **`config.json` for settings**. The service reads
`.env` first, then `config.json`, then optional per-view / scenario files.

### `.env` (secrets, never committed)

```
GOOGLE_SERVICE_ACCOUNT_KEY_PATH=./secrets/service-account.json
SHEET_ID=1AbC...xyz
HTTP_PORT=8080
```

### `config.json` (local settings, gitignored)

Copy `config/config.example.json` to `config/config.json` on first setup. The example file
is committed; your local `config.json` is gitignored so show-specific tweaks (admin saves,
field maps, Ableton IP) do not churn in version control.

```bash
cp config/config.example.json config/config.json
```

See `config/config.example.json` in the repo for the current template. Shape:

```json
{
  "ingest": {
    "oscListenPort": 11001,
    "oscSendPort": 11000,
    "abletonHost": "127.0.0.1",
    "watchedTracks": ["Cue", "Vocals", "Master"],
    "authoritative": { "strategy": "track", "track": "Cue" }
  },
  "sim": {
    "enabled": false,
    "mode": "internal",
    "driver": "sheetClipNames",
    "scenario": "./config/scenarios/demo-set.json",
    "intervalSeconds": 8
  },
  "sheets": {
    "worksheet": "Cues",
    "matchColumn": "Clip Name",
    "aliasColumn": "Aliases",
    "refreshSeconds": 30,
    "cacheFile": "./data/sheet-cache.json"
  },
  "match": {
    "threshold": 0.4,
    "normalize": { "lowercase": true, "stripPunctuation": true, "stripVersionTags": true }
  },
  "server": { "wsHeartbeatSeconds": 5 },
  "views": {
    "band":     { "title": "Band",     "fields": [ { "column": "Key" }, { "column": "BPM" }, { "column": "Band Notes", "label": "Notes" } ] },
    "visuals":  { "title": "Visuals",  "fields": [ { "column": "Mood" }, { "column": "Visual Notes", "label": "Notes" }, { "column": "Color" } ] },
    "lighting": { "title": "Lighting", "fields": [ { "column": "Lighting Cue" }, { "column": "BPM" } ] },
    "admin":    { "title": "Admin",    "system": true }
  }
}
```

Notes:
- `threshold` semantics follow `fuse.js` (0 = exact, 1 = match anything). Tune on the real
  sheet. Surface the effective confidence in the admin view.
- `stripVersionTags` should strip trailing tokens like `v2`, `- alt`, BPM suffixes, etc.,
  from both the incoming clip name and the match column before scoring.
- View field maps are how each operator view "looks slightly different" from the same
  matched row.

---

## 9. Data contracts

Keep these types stable; they are the seams between modules. Both the real listener and the
simulator emit `NowPlaying`, so downstream code never knows or cares which source is active.

### 9.1 Ingest → matcher: `NowPlaying`

```json
{
  "timestamp": "2026-07-07T20:15:04.512Z",
  "source": "abletonosc",
  "tracks": [
    { "trackIndex": 2, "trackName": "Cue", "clipName": "Song A - Intro", "slotIndex": 3 }
  ],
  "authoritativeClip": "Song A - Intro",
  "tempo": 128.0,
  "beat": 12
}
```

- `authoritativeClip` is `null` when nothing is playing on the authoritative source.
- `source` is `"abletonosc"` or `"simulator"` (drives the SIMULATION banner, NFR-8).

### 9.2 Matcher → server → views: `CuePayload`

```json
{
  "clipName": "Song A - Intro",
  "match": {
    "matched": true,
    "confidence": 0.92,
    "rowId": "12",
    "matchedValue": "Song A - Intro",
    "viaAlias": false
  },
  "row": { "Clip Name": "Song A - Intro", "Key": "A minor", "BPM": "128", "Band Notes": "...", "...": "..." },
  "tempo": 128.0,
  "beat": 12,
  "syncedAt": "2026-07-07T20:12:00.000Z",
  "stale": false,
  "simulated": false
}
```

- `match.matched: false` (below threshold) → views render the "no confident match" state and
  MUST NOT show a stale/incorrect row (NFR-7).
- `stale: true` when serving from cache after a failed sync (NFR-3).
- `simulated: true` when the source is the simulator.

### 9.3 Google Sheet contract

- Row 1 = headers. Each subsequent row = one cue.
- MUST contain the configured `matchColumn`. MAY contain the `aliasColumn` (pipe- or
  comma-separated alternate strings that also match this row — the deterministic escape
  hatch for clips fuzzy matching would fumble).
- All other columns are free-form role data referenced by view field maps.
- `rowId` = the sheet row number (or a stable ID column if present).

### 9.4 Per-view config → rendering

Each view subscribes over WebSocket, receives `CuePayload`, and renders the fields listed in
its config, in order, using `label ?? column` as the caption. Unknown/empty columns render a
blank placeholder, not an error.

---

## 10. Build order (milestones)

Each milestone should end green and demoable. Prototype the whole chain against the
simulator first, then AbletonOSC.

- **M1 — Skeleton + ingest + simulator.** Service bootstrap, config loader (`.env` +
  `config.json`), structured logging, systemd unit. Ingest interface with two sources: the
  AbletonOSC listener (resolves the authoritative playing clip via the `track` strategy) and
  the **simulator** (§7). Acceptance: with `sim.enabled: true`, correct `NowPlaying` events
  are produced and the admin view shows the SIMULATION banner; against real AbletonOSC,
  launching/stopping clips prints correct names; **no** write messages ever leave the process
  (assert via test — NFR-1).
- **M2 — Sheets sync + offline cache.** Service-account read of the whole worksheet into
  memory, periodic refresh, persist snapshot to `cacheFile`, load from cache on startup and
  on sync failure. Acceptance: kill the network → tool still has the last snapshot and flags
  it stale.
- **M3 — Fuzzy matcher.** Normalize + `fuse.js` match of `authoritativeClip` against
  `matchColumn` (and `aliasColumn`), with threshold and confidence. Acceptance: representative
  clip names map to the right rows; below-threshold inputs return `matched: false`.
- **M4 — View server + first view.** HTTP + WebSocket; serve one role view + the shared WS
  client; push `CuePayload` on change; view auto-reconnects and shows connection +
  last-update. Acceptance: driven by the simulator, launching a clip updates the browser view
  in < 200 ms.
- **M5 — Remaining views + admin/status.** Config-driven field maps for all 1–4 views; admin
  view shows current clip, matched row, confidence, last sync, connected-view count, cache
  staleness, and the SIMULATION banner when active. Acceptance: each view shows its configured
  slice; admin reflects reality.
- **M6 — Hardening.** Auto-restart, reconnect logic (Ableton restart, network loss), config
  validation on boot, log rotation, a `/health` endpoint. Acceptance: power-cycle the box →
  everything comes back with no human intervention.

---

## 11. Extension points for future work (do not build now)

Design so these drop in without rework:

- **OSC rebroadcast** of clip triggers: the `NowPlaying`/match event stream is the tap point.
  A future `outputs/osc` module subscribes to the same internal event bus and emits outbound
  OSC. Keep an internal event emitter that both the view server and future outputs subscribe
  to.
- **Waveform + playhead:** would require the playing clip's audio + `playing_position`
  (AbletonOSC `/live/clip/start_listen/playing_position`). Leave room in `CuePayload` for a
  future `playhead` field and keep the view layer capable of rendering an extra panel.

---

## 12. Open decisions (confirm with maintainer)

- **OD-1 — Authoritative "now playing" source. [RESOLVED]** v2026 uses the `track` strategy
  (designated cue track). Set `ingest.authoritative.track` to the real cue track's name/index.
- **OD-2 — Implementation language.** Node.js assumed (§5). Confirm, or swap to Python +
  FastAPI + `rapidfuzz` (identical architecture and data contracts).
- **OD-3 — Views + columns.** The field maps in §8 are placeholders. Confirm the real set of
  operator views (names, count 1–4) and the actual Google Sheet columns each shows.
- **OD-4 — Sheet match column + aliases.** Confirm which column holds the value clip names are
  matched against, and whether an alias column will be maintained.
- **OD-5 — Hardware/OS.** Assumed Linux (Ubuntu Server) on a dedicated mini-PC or Pi, with
  systemd. Confirm; if Windows, swap the systemd unit for an NSSM service.

---

## 13. Definition of done (v2026)

- Launching clips in the live Ableton set updates all configured operator views in real time,
  with the correct matched row per view layout.
- Below-threshold clips show an explicit no-match state.
- Google/network outage does not take down the views; staleness is visible.
- The box boots straight into the running service and self-heals on crash.
- A test proves the process never emits an Ableton write message.
- AbleView can be run, demoed, and rehearsed end-to-end using the **simulator** with no
  Ableton session present.
- Config (IPs, ports, sheet ID, threshold, views) is changeable without code edits.

---

## Appendix A — Suggested directory layout

```
ableview/
  src/
    ingest/
      index.js        # ingest interface + source selection
      sources/
        abletonosc.js # real listener (v2026 default)
        simulator.js  # simulation source (internal + manual drivers)
    sim/
      osc-emitter.js  # optional: mimic AbletonOSC on the wire (mode: "osc")
    sheets/           # sync, in-memory store, offline cache
    match/            # normalize + fuzzy matching
    server/           # HTTP + WebSocket, serves views, pushes CuePayload
    core/             # internal event bus, shared types
    config/           # loader + validation
    index.js          # bootstrap / wiring
  public/
    views/            # band.html, visuals.html, lighting.html, admin.html
    shared/           # ws-client.js, styles.css
  config/
    config.example.json   # committed template
    config.json           # local copy (gitignored)
    scenarios/
      demo-set.json
  data/
    sheet-cache.json
  secrets/            # service-account.json (gitignored)
  deploy/
    ableview.service  # systemd unit (Restart=always, WantedBy=multi-user.target)
  .env                # gitignored
  README.md
```

## Appendix B — Example systemd unit

```ini
[Unit]
Description=AbleView
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/ableview
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```
