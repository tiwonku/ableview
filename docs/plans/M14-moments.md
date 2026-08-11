# M14 — Moments (crew Stream Deck markers)

Build plan for **human-in-the-loop show markers** — crew and band members tap a Stream Deck
button (via **Bitfocus Companion**) to stamp **SMPTE-aligned moments** into the active **session
log** JSONL. A separate VOD/post tool consumes the same file alongside video to generate clips,
start conversations, etc.

Working title for the first button: **"dope"** (`kind: "dope"`). The contract is generic so
additional kinds (e.g. **`not_dope`**) are config + Companion buttons, not a schema change.

**Agent workflow:** one sub-milestone (M14a–M14d) per session/commit. Run `npm test` after each
stage. Validate with `npm run sim` + Companion **Generic HTTP Requests** before show validation.

**Related:** M10 session cue log ([`M10-session-cue-log.md`](./M10-session-cue-log.md)),
[`src/session-log/`](../../src/session-log/), [`ROADMAP.md`](../../ROADMAP.md),
[`AGENTS.md`](../../AGENTS.md).

---

## 1. Goal and non-goals

### Goal

- **Companion → AbleView HTTP** — one press appends a **`moment`** line to the **same session
  JSONL** as `track_clip`, `match`, and `launch` events (M10).
- Each moment includes an **SMPTE-style timestamp** via existing `resolveLogTimestamp()` (Art-Net
  when live; wall-clock fallback when not).
- **Expandable kinds** — v1 ships **`dope`**; config allowlist accepts future kinds
  (`not_dope`, `flag`, …) without API redesign.
- **Optional identity** — `who` (e.g. `"keys"`, `"bass"`, `"deck-2"`) is set per Companion button
  in the JSON body; omit when anonymous is fine.
- **Session log gate (default on)** — moments are rejected with a clear HTTP error when session
  logging is disabled; config flag to relax later.
- **Companion setup doc** — copy-paste recipe using built-in **Generic HTTP Requests** (no custom
  module required for v1).

### Non-goals

- **Custom Bitfocus Companion module** in v1 (follow-up for dropdown kinds, connection-level
  `who`, reliable button feedback variables).
- **OSC ingress** for moments (Ableton OSC path stays read-only; NFR-1 unchanged).
- **Separate moments-only export file** — filter `event == "moment"` from session JSONL.
- **Authenticated API** — LAN trust boundary same as existing `/api/*` (settings, sheets).
- **Operator browser UI** for marking moments (hardware buttons only in v1).
- **Auto-start session log** on first moment tap (explicit rejection when logging off; see OD-M3).
- **Rich notes UI** — optional short `note` string in JSON body only; no Stream Deck text entry in v1.

---

## 2. Problem statement

### What exists (M10)

- Append-only session JSONL under `data/sessions/<name>.jsonl`.
- Automatic events: `track_clip`, `match`, `launch` with Art-Net timestamps.
- Admin toggle + session name via `GET/PATCH /api/session-log`.

### What's missing

| Gap | Impact |
|---|---|
| No human bookmark channel | Crew cannot mark "that was great" without correlating wall-clock notes to VOD |
| No Companion integration | Stream Deck is the desired UX for non-operator crew |
| No `moment` event type | Downstream VOD tool cannot distinguish crew taps from cue timeline |

**Desired downstream flow:**

```
show night → session JSONL (cue + moment timeline)
          → VOD tool loads video + JSONL
          → filter event == "moment"
          → seek to timestamp → clip / thread / review queue
```

---

## 3. Architecture

### 3.1 Overview

```
  Stream Deck
       → Bitfocus Companion (Generic HTTP)
            POST /api/moments { kind, who?, note? }
                 │
                 ▼
  Fastify route (src/server/moments-api.js)
       → sessionLog.logMoment({ kind, who, note })
                 │
                 ├─ resolveLogTimestamp(getTimecodeStatus)
                 ├─ validate kind against config allowlist
                 ├─ reject if session log disabled (default policy)
                 └─ append JSONL line (event: "moment")
```

```mermaid
flowchart LR
  subgraph hardware [Crew hardware]
    SD["Stream Deck"]
    CP["Companion"]
  end
  subgraph ableview [AbleView show box]
    API["POST /api/moments"]
    SL["Session logger"]
    TC["Art-Net timecode"]
    JSONL["data/sessions/*.jsonl"]
  end
  subgraph post [Post-show]
    VOD["VOD / clip tool"]
  end
  SD --> CP
  CP -->|"HTTP POST"| API
  TC --> SL
  API --> SL
  SL --> JSONL
  JSONL --> VOD
```

### 3.2 Design principles

1. **Same file, new event type** — moments are first-class timeline citizens alongside cue events.
2. **HTTP over OSC** — Companion already speaks HTTP; avoids a second protocol surface on the show
   box and keeps Ableton ingest mentally separate.
3. **Kind allowlist in config** — prevents typo spam (`"dop"`) while staying extensible.
4. **Fail loud when logging off** — crew gets immediate feedback (HTTP 409) rather than silent drops.
5. **Thin API, fat log contract** — VOD tool depends on JSONL shape, not AbleView runtime.

---

## 4. Open decisions (defaults for implementation)

| ID | Topic | Default for M14 |
|---|---|---|
| OD-M1 | Event name in JSONL | **`event: "moment"`** |
| OD-M2 | Kind field | **`kind`** string; v1 allowlist `["dope"]`; example config documents `"not_dope"` |
| OD-M3 | Require session log enabled | **`moments.requireSessionLog: true`** — `409` when disabled |
| OD-M4 | `who` field | **Optional** — omit or `null` when anonymous; max length 64, sanitized |
| OD-M5 | `note` field | **Optional** — max length 200, single line, stripped control chars |
| OD-M6 | API path | **`POST /api/moments`** (collection semantics; one moment per request) |
| OD-M7 | Default `kind` when omitted | **`"dope"`** if body empty or kind missing (convenience for minimal Companion body) |
| OD-M8 | Debounce double-taps | **Optional `moments.debounceMs`** (default `0` = off); when set, ignore duplicate `kind+who` within window |
| OD-M9 | Success response | **`200`** + `{ ok, timestamp, timestampSource, loggedAt, kind, who, sessionName }` |
| OD-M10 | Companion module | **Out of v1** — document Generic HTTP; module listed in §12 |
| OD-M11 | Admin visibility | **Optional M14c** — show last moment + count in session-log panel or settings |
| OD-M12 | Simulated flag | **`simulated: true`** when `getSimulated()` is true (same as other session events) |

---

## 5. Configuration

Add to `config/config.example.json` (and `DEFAULTS` in `src/config/index.js`):

```json
"moments": {
  "requireSessionLog": true,
  "kinds": ["dope"],
  "debounceMs": 0
}
```

| Key | Type | Default | Notes |
|---|---|---|---|
| `moments.requireSessionLog` | boolean | `true` | When true, `POST /api/moments` returns **409** if session log disabled |
| `moments.kinds` | string[] | `["dope"]` | Allowlist for `kind`; unknown kind → **400** |
| `moments.debounceMs` | number | `0` | `0` = no debounce; e.g. `300` suppresses duplicate `kind+who` within window |

**Editable from admin settings (M14c):** add `moments` to `EDITABLE_SECTIONS` in
`src/config/runtime.js` so `requireSessionLog`, `kinds`, and `debounceMs` can be tuned without
SSH. Session log on/off remains **`/api/session-log`** (runtime), not config.

---

## 6. Data contract

### 6.1 JSONL record — `event: "moment"`

Appended to the active session file when logging is enabled and the request is accepted.

```json
{
  "timestamp": "01:23:45:12",
  "timestampSource": "artnet",
  "loggedAt": "2026-08-11T21:15:04.512Z",
  "event": "moment",
  "kind": "dope",
  "who": "keys",
  "note": null,
  "sessionName": "show-night-1",
  "simulated": false
}
```

| Field | Required | Notes |
|---|---|---|
| `timestamp` | yes | Same rules as M10 (`resolveLogTimestamp`) |
| `timestampSource` | yes | `"artnet"` \| `"clock"` |
| `loggedAt` | yes | ISO8601 append time |
| `event` | yes | Always `"moment"` |
| `kind` | yes | From allowlist (e.g. `"dope"`, future `"not_dope"`) |
| `who` | no | Opaque crew/deck label from Companion; `null` if omitted |
| `note` | no | Optional free text; `null` if omitted |
| `sessionName` | yes | Active session basename |
| `simulated` | yes | `true` when sim mode active |

**Correlation:** Moments share `timestamp` / `sessionName` with adjacent `track_clip` and `match`
lines — VOD tool merges on time, not foreign keys.

**Do not log** internal debounce skip reasons to JSONL (debug via pino only).

### 6.2 Downstream consumer notes

- Filter: `jq -c 'select(.event == "moment")' data/sessions/show-night-1.jsonl`
- Seek VOD to `timestamp` when `timestampSource == "artnet"`; fall back to `loggedAt` correlation
  when `"clock"`.
- `kind` drives post-show routing (clip queue vs review vs "not dope" bin).

---

## 7. REST API

### 7.1 `POST /api/moments`

Log one moment.

**Request**

```http
POST /api/moments HTTP/1.1
Host: <show-box>:<HTTP_PORT>
Content-Type: application/json

{
  "kind": "dope",
  "who": "keys",
  "note": "optional short note"
}
```

| Body field | Required | Default | Validation |
|---|---|---|---|
| `kind` | no | `"dope"` | Must be in `moments.kinds` |
| `who` | no | `null` | Max 64 chars; trim; empty → `null` |
| `note` | no | `null` | Max 200 chars; strip `\r\n`; empty → `null` |

**Response 200**

```json
{
  "ok": true,
  "timestamp": "01:23:45:12",
  "timestampSource": "artnet",
  "loggedAt": "2026-08-11T21:15:04.512Z",
  "kind": "dope",
  "who": "keys",
  "sessionName": "show-night-1"
}
```

**Response 409** — session log disabled and `moments.requireSessionLog === true`

```json
{
  "error": "session_log_disabled",
  "message": "Enable session logging before marking moments."
}
```

**Response 400** — validation errors

```json
{ "error": "unknown_kind", "kind": "dop" }
```

```json
{ "error": "who_too_long" }
```

**Response 429** (optional, only if debounce enabled and hit)

```json
{ "error": "debounced", "retryAfterMs": 120 }
```

Use **429** vs silent drop so Companion can flash warning feedback if wired later.

### 7.2 `GET /api/moments` (M14b, optional but recommended)

Lightweight probe for Companion feedback / health checks.

```json
{
  "ok": true,
  "sessionLogEnabled": true,
  "sessionName": "show-night-1",
  "kinds": ["dope"],
  "lastMoment": {
    "loggedAt": "2026-08-11T21:15:04.512Z",
    "kind": "dope",
    "who": "keys"
  }
}
```

When session log disabled: `sessionLogEnabled: false`, `lastMoment: null`.

---

## 8. Session logger changes

### 8.1 New method — `logMoment({ kind, who, note })`

In `src/session-log/index.js`:

```javascript
function logMoment({ kind, who = null, note = null }) {
  // 1. If !enabled && requireSessionLog → throw SessionLogDisabledError (or return result object)
  // 2. Validate kind against getConfig().moments.kinds
  // 3. Optional debounce check (kind + who key)
  // 4. timestampEnvelope() → appendRecord({ ...envelope, event: 'moment', kind, who, note, sessionName, simulated })
  // 5. Update lastMoment cache for GET /api/moments
  // 6. Return { timestamp, timestampSource, loggedAt, kind, who, sessionName }
}
```

Export on `createSessionLogger` return object alongside `getStatus`, `applyPatch`.

**Sidecar:** optionally extend `data/sessions/.active.json` with `lastMoment` summary (not
required for v1 — in-memory cache refreshed on append is enough if process restart clears it).

### 8.2 Wiring

- `src/index.js` — pass `sessionLog` to server (already done).
- `src/server/index.js` — `registerMomentsRoutes(app, { sessionLog, getConfig, log })`.
- `src/server/moments-api.js` — route handlers.

---

## 9. Bitfocus Companion setup (v1 — Generic HTTP)

No custom module in v1. Document in **`docs/companion-moments.md`** (M14d).

### 9.1 Connection

1. Open Companion → **Connections** → **Add connection**.
2. Search **Generic HTTP Requests** → Add.
3. **Label:** `AbleView`
4. **Base URL:** `http://<SHOW_BOX_IP>:<HTTP_PORT>` (from `.env` `HTTP_PORT`, default check
   project docs).
5. Save.

### 9.2 "Dope" button (per deck)

1. **Buttons** tab → pick an empty key.
2. **Button text:** `DOPE` (or emoji).
3. **Press actions** → add action → **AbleView** connection → **POST**.
4. **URL path:** `/api/moments`
5. **Body** (JSON):

```json
{"kind":"dope","who":"keys"}
```

Replace `"keys"` per button (`"bass"`, `"drums"`, `"foh"`, …). Omit `who` for anonymous.

6. **Test** (▶) — expect HTTP 200 when session log is on; 409 when off.

### 9.3 Future "NOT DOPE" button

1. Add `"not_dope"` to `moments.kinds` in config (admin settings or `config.json`).
2. Duplicate button; change label and body:

```json
{"kind":"not_dope","who":"keys"}
```

No AbleView code change beyond config allowlist.

### 9.4 Button feedback (reliability notes)

| Approach | v1 | Follow-up |
|---|---|---|
| Companion **internal: custom variable** + press action sets green on 200 | Manual / fragile with Generic HTTP | Custom module |
| **GET /api/moments** poll + feedback condition | Possible but heavy | Custom module |
| Operator confirms via admin **last moment** line | **M14c** | Good enough for rehearsal |

**Recommendation:** ship v1 without guaranteed LED feedback; document 200 vs 409 behavior; custom
Companion module (§12) for production feedback.

---

## 10. Sub-milestones

### M14a — Logger + config + validation

**Scope**

- `moments` config section + validation in `src/config/index.js`.
- `sessionLog.logMoment()` with kind allowlist, optional `who`/`note` sanitization, timestamp
  envelope, `simulated` flag.
- `moments.requireSessionLog` enforcement inside logger.
- Optional debounce when `debounceMs > 0`.
- Unit tests in `test/moments.test.js` (temp dir JSONL, artnet vs clock timestamp mock).

**Acceptance**

- With session log enabled, `logMoment({ kind: 'dope', who: 'keys' })` appends one JSONL line.
- With session log disabled + `requireSessionLog: true`, throws or returns error result (API maps
  to 409 in M14b).
- Unknown kind rejected.
- `npm test` green.

**Agent prompt**

> Implement M14a per `docs/plans/M14-moments.md` §10 (M14a): add `moments` config defaults and
> validation, `sessionLog.logMoment()` in `src/session-log/index.js`, tests in
> `test/moments.test.js`. Follow M10 timestamp patterns. Run `npm test`. Do not commit unless asked.

---

### M14b — REST API

**Scope**

- `src/server/moments-api.js` — `POST /api/moments`, `GET /api/moments`.
- Register in `src/server/index.js`.
- Map logger errors to HTTP status codes.
- `test/moments-api.test.js` using `createViewServer` pattern from `test/session-log-api.test.js`.

**Acceptance**

- `POST` with session log on → 200 + stamped fields; file grows by one line.
- Session log off + default config → 409.
- Bad kind → 400.
- `GET` reflects `sessionLogEnabled` and last moment.
- `npm test` green.

**Agent prompt**

> Implement M14b per `docs/plans/M14-moments.md` §10 (M14b): POST/GET `/api/moments`, register
> routes, API tests. Run `npm test`. Do not commit unless asked.

---

### M14c — Admin settings + status (optional UI)

**Scope**

- Add `moments` to `EDITABLE_SECTIONS`.
- Settings form fields: `requireSessionLog`, `kinds` (comma-separated or JSON array), `debounceMs`.
- Session log panel: optional **last moment** + **moment count** (scan sidecar or track in logger).

**Acceptance**

- Change allowlist in admin → `"not_dope"` accepted after save + config reload.
- Settings page shows last moment when present.
- `npm test` green.

**Agent prompt**

> Implement M14c per `docs/plans/M14-moments.md` §10 (M14c): editable `moments` config in admin
> settings, optional last-moment status in session log panel. Run `npm test`. Do not commit unless
> asked.

---

### M14d — Companion doc + roadmap

**Scope**

- `docs/companion-moments.md` — copy-paste Companion recipe (§9).
- Update `ROADMAP.md` M14 → done when all sub-milestones ship.
- Optional one-line in `AGENTS.md` under session-log / server notes.

**Acceptance**

- Another crew member can add a DOPE button from the doc alone.
- `npm test` green (no code change if doc-only).

**Agent prompt**

> Implement M14d per `docs/plans/M14-moments.md` §10 (M14d): add `docs/companion-moments.md`,
> update ROADMAP M14 status. Do not commit unless asked.

---

## 11. Operator runbook

1. Before show: enable **session logging** on Settings (`/views/settings.html`); set session name
   (e.g. `show-night-1`).
2. Enable **Art-Net timecode** in settings if the show sends SMPTE (strongly recommended for VOD
   alignment).
3. On Companion machine: create **AbleView** Generic HTTP connection pointing at the show box.
4. Configure one **DOPE** button per crew member; set `who` in the JSON body per person/deck.
5. **Test** during soundcheck — press button; confirm line count increases or admin shows last moment.
6. If button returns error: check session log toggle first (409 = logging off).
7. After show: copy `data/sessions/show-night-1.jsonl` for the VOD tool.

**Example jq — moments only**

```bash
jq -c 'select(.event == "moment") | {timestamp, kind, who, note}' data/sessions/show-night-1.jsonl
```

**Example jq — merged timeline (moments + cue context)**

```bash
jq -c 'select(.event == "moment" or .event == "match") | {timestamp, event, kind, clip: .clipName, who}' data/sessions/show-night-1.jsonl
```

---

## 12. Future extensions (out of M14 scope)

- **Custom Companion module** (`companion-module-ableview`) — connection-level host/port, kind
  dropdown from `GET /api/moments`, button feedback variables (`$(moment:last_ok)`), preset import.
- **OSC ingress** — `/ableview/moment` on a dedicated listen port → same `logMoment()` (only if
  Companion OSC is preferred over HTTP on some rigs).
- **Separate export** `GET /api/session-log/download?filter=moment` — convenience for VOD tool.
- **Moment categories in config** — map kinds → colors/priority for downstream tool.
- **Hold vs press** — long-press different kind (Companion timing, same API).
- **Rate limit / auth token** if show box is on a wider network.
- **WebSocket broadcast** `moment` event for on-screen flash in admin during rehearsal.

---

## 13. Known limitations

- **Generic HTTP** does not give reliable Stream Deck LED state on success/failure without extra
  Companion wiring or a custom module.
- **Clock fallback** uses frames `00` — same as M10; VOD correlation is weaker without Art-Net.
- **No dedupe across kinds** — `dope` then `not_dope` two seconds apart both log (by design).
- **Debounce** keyed on `kind+who` only when enabled; global debounce is not supported.
- **Process restart** clears in-memory `lastMoment` unless sidecar extension is added later.
- **LAN trust** — anyone who can reach the show box HTTP port can spam moments (mitigate with
  network segmentation).

---

## 14. Testing checklist

| Test | File |
|---|---|
| `logMoment` appends valid JSONL line | `test/moments.test.js` |
| Art-Net vs clock timestamp | `test/moments.test.js` |
| Unknown kind rejected | `test/moments.test.js` |
| Session log disabled + requireSessionLog → error | `test/moments.test.js` |
| `who` optional / sanitized | `test/moments.test.js` |
| Debounce suppresses duplicate | `test/moments.test.js` |
| POST 200 / 409 / 400 | `test/moments-api.test.js` |
| GET reflects enabled + last moment | `test/moments-api.test.js` |
| Config validation for `moments.kinds` | `test/config.test.js` or existing config tests |

Use `node:test`, `assert`, temp dir via `fs.mkdtempSync`.

---

## 15. Effort (planning)

| Stage | Agent-assisted (indicative) |
|---|---|
| M14a | ~2–3 hours |
| M14b | ~1–2 hours |
| M14c | ~1–2 hours |
| M14d | ~30 min |
| **Total** | ~0.5–1 day |

---

## 16. Milestone completion checklist

- [ ] M14a — config + `logMoment()` + tests
- [ ] M14b — POST/GET `/api/moments` + API tests
- [ ] M14c — admin settings + optional last-moment UI
- [ ] M14d — `docs/companion-moments.md` + ROADMAP
- [ ] Manual QA: Companion POST during `npm run sim` with session log enabled

---

## 17. Copy-paste agent prompts (full chain)

**Session 1 — M14a**

> Implement M14a per `docs/plans/M14-moments.md` §10 (M14a): `moments` config, `logMoment()` on
> session logger, validation and tests. Run `npm test`. Do not commit unless asked.

**Session 2 — M14b**

> Implement M14b per `docs/plans/M14-moments.md` §10 (M14b): REST routes for `/api/moments`, wire
> into view server, API tests. Run `npm test`. Do not commit unless asked.

**Session 3 — M14c**

> Implement M14c per `docs/plans/M14-moments.md` §10 (M14c): admin-editable moments config,
> optional last-moment display in settings. Run `npm test`. Do not commit unless asked.

**Session 4 — M14d**

> Implement M14d per `docs/plans/M14-moments.md` §10 (M14d): Companion setup doc, update ROADMAP.
> Do not commit unless asked.
