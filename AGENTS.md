# AGENTS.md — AbleView

Guidance for AI coding agents working in this repository.

## What this project is

AbleView is a headless **"now playing" board** for a live show. It:

1. **Listens** to a master Ableton session (read-only OSC) for the currently-playing clip
2. **Looks up** that clip in a Google Sheet of cue notes (fuzzy match)
3. **Pushes** the matched row to 1–4 role-specific operator web views over WebSocket

It runs unattended on show nights on a dedicated box (Windows NUC or Raspberry Pi). Operators open a browser — no app install.

**Authoritative spec:** [`ableview_spec_from_claude.md`](./ableview_spec_from_claude.md) — treat §4 (NFRs), §9 (data contracts), and §10 (milestones) as the build contract.

---

## Current status

| Milestone | Description | Status |
|---|---|---|
| **M1** | Skeleton + ingest + simulator | ✅ **Done** |
| **M2** | Sheets sync + offline cache | ✅ **Done** |
| **M3** | Fuzzy matcher | Not started |
| **M4** | View server + first view | Not started |
| **M5** | Remaining views + admin/status | Not started |
| **M6** | Hardening | Not started |

**M1 delivered:** config loader, event bus, `NowPlaying` contract, read-only AbletonOSC ingest, simulator (internal + on-the-wire `osc` mode), NFR-1 tests, systemd unit stub.

---

## Agent workflow (recommended)

### Before you code

1. Read the relevant spec section (§4, §8–§10) for the milestone you're implementing.
2. Scan existing patterns in `src/` — match naming, module boundaries, and logging style.
3. Confirm the milestone acceptance criteria from §10 before marking work complete.

### How to scope a session

- **One milestone per session/commit.** Milestones are independently testable; don't batch M2–M5 into one change.
- **Use the simulator first.** `npm run sim` exercises the full chain without Ableton or Google. Only validate against real AbletonOSC after the sim path works.
- **Keep diffs focused.** This project favors minimal, boring dependencies and small modules over abstraction.

### Before you finish

1. Run `npm test` — all tests must pass.
2. If you touched `src/ingest/` or OSC code, confirm NFR-1 tests still pass (`test/nfr1-readonly.test.js`).
3. Demo the milestone acceptance criteria (see §10 in the spec).
4. Update the status table in `README.md` when a milestone ships.
5. Do **not** commit unless the user asks.

### When to escalate to a stronger model

Use a heavier model (or ask the user) when:

- Fuzzy match threshold tuning against messy real clip names (M3)
- Windows service / Pi deployment edge cases (M6)
- Debugging intermittent OSC, WebSocket, or process-lifecycle issues
- Architectural decisions not covered by the spec

For well-specified, pattern-following work (M2–M5), a fast model is appropriate.

---

## Hard constraints (non-negotiable)

These come from spec §4. Violating them is a show-stopper.

### NFR-1 — Ableton isolation (critical)

The tool **MUST NOT** send any OSC message that can mutate the Ableton set.

- All outbound OSC goes through `assertReadOnlyAddress()` in `src/ingest/osc-addresses.js`.
- The allowlist is the **only** way to emit OSC toward Ableton.
- **Never** add write addresses (`/live/**/set`, `/live/**/fire`, `/live/**/create_*`, `/live/**/delete_*`, transport writes).
- Tests in `test/nfr1-readonly.test.js` scan the adapter source structurally — keep them green.

### NFR-3 — Offline capability

Sheets sync must never block the hot path. Match against in-memory data; refresh on an interval; serve from disk cache when Google/network is down; surface staleness in admin view.

### NFR-7 — Match safety

Below-threshold matches **MUST** show an explicit "no confident match" state. Never silently display a wrong row.

### Out of scope (do NOT build)

- Outbound OSC rebroadcast to lighting consoles
- Waveform + playhead display
- Any write-back to Ableton

Leave extension points (event bus, `CuePayload` shape) clean — see spec §11.

---

## Architecture (established in M1)

```
AbletonOSC / Simulator  →  event bus  →  [matcher]  →  [view server]  →  operator browsers
                              ↑
                        sheets sync (in-memory + disk cache)
```

### Key seams

| Module | Path | Role |
|---|---|---|
| Event bus | `src/core/bus.js` | Internal pub/sub. Ingest emits `nowPlaying`; matcher and view server subscribe. Future OSC rebroadcast taps here too. |
| NowPlaying | `src/core/now-playing.js` | Ingest → matcher contract (§9.1). Both real listener and simulator emit this shape. |
| Config | `src/config/index.js` | `.env` + `config/config.json` loader with validation. |
| Ingest | `src/ingest/` | Source interface. Real: `abletonosc.js`. Sim: `simulator.js` + optional `sim/osc-emitter.js`. |
| Logger | `src/core/logger.js` | pino, structured JSON. |

### Planned modules (not yet implemented)

| Module | Path | Milestone |
|---|---|---|
| Sheets | `src/sheets/` | M2 |
| Matcher | `src/match/` | M3 |
| Server | `src/server/` | M4–M5 |
| Views | `public/views/`, `public/shared/` | M4–M5 |

### Data contracts (keep stable — spec §9)

- **`NowPlaying`** — ingest → matcher (`src/core/now-playing.js`)
- **`CuePayload`** — matcher → server → views (implement in M3/M4)
- **`EVENTS.NOW_PLAYING`** — add `EVENTS.CUE_PAYLOAD` (or similar) when wiring matcher → server

---

## Configuration

Two layers (spec §8):

| File | Committed? | Contents |
|---|---|---|
| `.env` | **No** (gitignored) | `GOOGLE_SERVICE_ACCOUNT_KEY_PATH`, `SHEET_ID`, `HTTP_PORT` |
| `config/config.json` | Yes | OSC ports, watched tracks, authoritative cue track, sim settings, match threshold, view field maps |

Rules:

- **No hardcoded** IPs, ports, sheet IDs, column names, or view layouts in source code.
- Use defaults in `src/config/index.js` (`DEFAULTS`) for missing keys.
- `npm run sim` forces `sim.enabled: true` without editing config.

---

## Testing

```bash
npm test          # all tests (node:test runner)
npm run sim       # run simulator, walk demo scenario
npm start         # real AbletonOSC (requires Ableton + AbletonOSC on network)
```

| Test file | What it guards |
|---|---|
| `test/nfr1-readonly.test.js` | OSC allowlist, no write addresses, adapter source scan |
| `test/simulator.test.js` | NowPlaying contract, scenario driver, config validation |

Add tests per milestone where acceptance criteria are testable (matcher confidence, cache staleness, etc.).

---

## Milestone checklist

Use spec §10 acceptance criteria verbatim. Summary:

### M2 — Sheets sync + offline cache

- Service-account read of worksheet → in-memory store
- **`sheets.headerRow`** — 1-based row number of the header line (default `1`; use `4` for sheets with preamble rows)
- Periodic refresh (`sheets.refreshSeconds`)
- Persist to `data/sheet-cache.json`; load on startup and sync failure
- Wire `getClipNames` into simulator's `sheetClipNames` driver
- **Accept:** network killed → last snapshot still available, flagged stale
- **Add dep:** `googleapis`

### M3 — Fuzzy matcher

- Normalize clip names + match column (lowercase, strip punctuation, strip version tags)
- `fuse.js` against `matchColumn` + `aliasColumn` (pipe/comma-separated aliases)
- Emit `CuePayload` on bus when `NowPlaying` changes
- **Accept:** representative names match; below threshold → `matched: false`
- **Add dep:** `fuse.js`

### M4 — View server + first view

- HTTP + WebSocket (`fastify` + `ws` per spec §5)
- Serve one role view + shared `ws-client.js`
- Push `CuePayload` on change; view auto-reconnects with connection state + last-update timestamp
- **Accept:** sim-driven clip change → browser updates in < 200 ms
- **Add deps:** `fastify`, `ws`
- **Frontend:** static HTML/CSS/vanilla JS, **no build step**

### M5 — Remaining views + admin/status

- Config-driven field maps for all views in `config.json`
- Admin view: current clip, matched row, confidence, last sync, connected-view count, cache staleness, **SIMULATION MODE banner**
- **Accept:** each view shows its configured slice; admin reflects reality

### M6 — Hardening

- Auto-restart, reconnect logic, config validation on boot, log rotation, `/health`
- Windows NUC: NSSM or Task Scheduler equivalent (alongside `deploy/ableview.service` for Linux/Pi)
- **Accept:** power-cycle → everything recovers with no human intervention

---

## Dependencies

**Current (M1):** `osc`, `pino`, `dotenv` — keep minimal.

**Planned additions:**

| Milestone | Package | Notes |
|---|---|---|
| M2 | `googleapis` | Service account read only |
| M3 | `fuse.js` | Pure JS, no native build |
| M4 | `fastify`, `ws` | HTTP + WebSocket |

Avoid native modules (e.g. `better-sqlite3`) unless explicitly needed. JSON file cache is sufficient for v2026.

---

## Deployment targets

| Environment | Service manager | Unit file |
|---|---|---|
| Linux / Raspberry Pi | systemd | `deploy/ableview.service` |
| Windows NUC (headless) | NSSM or Task Scheduler | TBD in M6 |

Node.js ≥ 20 (LTS). Runs on x64 Windows and ARM Pi without code changes.

---

## Open decisions (spec §12)

Confirm with the maintainer before hardcoding assumptions:

| ID | Topic | Default |
|---|---|---|
| OD-2 | Language | **Node.js** (confirmed in practice) |
| OD-3 | View names + sheet columns | Placeholders in `config/config.json` |
| OD-4 | Match column + aliases | `"Clip Name"` / `"Aliases"` |
| OD-5 | Hardware/OS | Linux/Pi for deploy; Windows NUC also supported |

OD-1 (authoritative cue track) is **resolved:** `track` strategy, cue track name `"Cue"`.

---

## File layout

```
src/
  config/           # loader + validation
  core/             # bus, logger, NowPlaying contract
  ingest/           # source interface + abletonosc + simulator
  sim/              # on-the-wire OSC mock (sim.mode "osc")
  sheets/           # (M2)
  match/            # (M3)
  server/           # (M4)
  index.js          # bootstrap / wiring
public/             # (M4) static views + shared ws-client
config/
  config.json       # committed settings
  scenarios/        # sim scenario files
data/               # runtime cache (gitignored except .gitkeep)
secrets/            # service account key (gitignored)
deploy/             # systemd unit
test/               # node:test suite
```

---

## Git / secrets

- **Never commit:** `.env`, `secrets/*`, `data/sheet-cache.json`
- **Never commit** unless the user explicitly asks
- `.env.example` documents required env vars without values

---

## Quick reference commands

```bash
npm install
npm test
npm run sim
npm start
node src/index.js --sim    # same as npm run sim
```

When implementing, start prompts with: *"Implement M{N} per §10 and §8 of `ableview_spec_from_claude.md`, following existing patterns in `src/`."*
