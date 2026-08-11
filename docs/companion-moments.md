# Companion setup — Moments (Stream Deck)

Crew members mark **moments** in the show timeline via Stream Deck buttons. AbleView stamps each
tap into the active **session log** JSONL with an Art-Net SMPTE timestamp (when live).

**API:** `POST /api/moments` on the AbleView show box (same host/port as operator views).

**Importable page (optional):** see [`companion/README.md`](../companion/README.md) — a
`.companionconfig` page export can be imported after you map the AbleView HTTP connection.

---

## 1. Connection (Generic HTTP Requests)

1. Open **Bitfocus Companion** → **Connections** → **Add connection**.
2. Search **Generic HTTP Requests** → Add.
3. **Label:** `AbleView`
4. **Base URL:** `http://<SHOW_BOX_IP>:<HTTP_PORT>`  
   (`HTTP_PORT` is in `.env` on the show box, commonly `8080`.)
5. Save.

---

## 2. "Dope" button (per crew member / deck)

### Option A — preset `who` per button (simplest)

1. **Buttons** tab → pick an empty key.
2. **Button text:** `DOPE` (or `DOPE\nkeys` for two lines).
3. **Press actions** → **AbleView** connection → **POST**.
4. **URL path:** `/api/moments`
5. **Body** (JSON):

```json
{"kind":"dope","who":"keys"}
```

Replace `"keys"` per person or deck (`"bass"`, `"drums"`, `"foh"`, …). Omit `"who"` for anonymous.

6. Click **Test** (▶). Expect **HTTP 200**.

### Option B — one custom variable for `who`

Useful when one physical deck serves multiple people and you only change a variable once per show.

1. **Custom variables** → add `av_who` (default e.g. `keys`).
2. Same button setup as above, but body:

```json
{"kind":"dope","who":"$(custom:av_who)"}
```

3. Change `av_who` in Companion when a different person uses the deck.

---

## 3. Button feedback (green / yellow / red)

Generic HTTP does not expose HTTP status codes as button colors by itself. Use a **custom variable**
plus **button feedback** (Companion 3.5+ sequential actions recommended).

### Custom variable

Create **`av_moment_feedback`** (string). Values used by the recipe below:

| Value | Button color | Meaning |
|---|---|---|
| `pending` | Yellow | Press sent, waiting for response |
| `success` | Green | Moment logged (`feedbackState` in JSON) |
| `warning` | Amber | Debounced double-tap (HTTP 429) |
| `error` | Red | Rejected (409 strict mode, bad kind, network down) |

### Press actions (sequential group)

Add these actions **in order** inside a **Sequential** group (Companion 3.5+):

1. **Internal → Custom variable: Set** — `av_moment_feedback` = `pending`
2. **AbleView → POST** — path `/api/moments`, body with your `who` (see §2)
3. **AbleView → GET** — path `/api/moments`, store full JSON response in custom variable
   `av_moment_response` (enable “store in variable” if shown)
4. **Internal → Custom variable: Set with expression** — set `av_moment_feedback` from the POST
   result. Example expression (adjust to your Companion version):

```
$(custom:av_moment_response).ok === true ? 'success' : ($(custom:av_moment_response).feedbackState || 'error')
```

If GET variable storage is awkward on your Companion build, skip step 3–4 and use a **Trigger** on
connection status, or rely on the admin **Moments this session** counter for confirmation during
rehearsal.

### Button feedback (background color)

Add **Internal → Check custom variable** feedback (or expression feedback):

| Condition | Background |
|---|---|
| `av_moment_feedback` equals `success` | `#008800` (green) |
| `av_moment_feedback` equals `pending` | `#886600` (yellow) |
| `av_moment_feedback` equals `warning` | `#886600` (amber) |
| `av_moment_feedback` equals `error` | `#880000` (red) |

Reset to default/black on button release if you prefer a momentary flash.

### API `feedbackState` field

All POST responses include a machine-readable state for Companion parsing:

| HTTP | `feedbackState` | Typical cause |
|---|---|---|
| 200 | `success` | Moment appended |
| 400 / 409 | `error` | Bad kind, strict mode, validation |
| 429 | `warning` | Debounce suppressed duplicate |

Success body also includes **`momentCount`** (moments in the active session file).

---

## 4. "NOT DOPE" button (future)

1. In AbleView **Settings**, add `not_dope` to **Allowed kinds** (or edit `moments.kinds` in
   `config.json`).
2. Duplicate the DOPE button.
3. Change label and body:

```json
{"kind":"not_dope","who":"keys"}
```

No AbleView code change required.

---

## 5. Strict mode (optional)

To **require** session logging to be enabled before moments work:

1. Settings → **Moments** → uncheck **Auto-start session log on first moment tap**.
2. Enable logging manually on the **Session log** panel first.
3. Buttons return **409** with `feedbackState: "error"` if logging is still off.

---

## 6. Troubleshooting

| Symptom | Check |
|---|---|
| HTTP connection failed | Show box IP, firewall, `HTTP_PORT`, AbleView running |
| 409 `session_log_disabled` | Enable session log in Settings, or turn auto-start back on |
| 400 `unknown_kind` | Add the kind to **Allowed kinds** in Settings |
| Button stays yellow | Show box unreachable; check Generic HTTP connection test |
| Operator views don't show log name | Page must be open on the show box URL; check WebSocket connection dot |
| Admin counter not moving | Settings → Session log panel; counter updates live over WebSocket |

---

## 7. Response reference

**200 OK**

```json
{
  "ok": true,
  "feedbackState": "success",
  "timestamp": "01:23:45:12",
  "timestampSource": "artnet",
  "loggedAt": "2026-08-11T21:15:04.512Z",
  "kind": "dope",
  "who": "keys",
  "sessionName": "2026-08-11_211504",
  "momentCount": 3,
  "sessionLogStarted": true
}
```

**GET `/api/moments`** — probe for Companion feedback scripts:

```json
{
  "ok": true,
  "sessionLogEnabled": true,
  "sessionName": "2026-08-11_211504",
  "momentCount": 3,
  "kinds": ["dope"],
  "lastMoment": { "loggedAt": "...", "kind": "dope", "who": "keys" }
}
```

---

## 8. Importable page export

Companion page files (`.companionconfig`) are version-specific. After validating a layout on your
Companion version:

1. Configure one feedback-aware DOPE button using §3.
2. **Buttons** → **Export page** → save as `companion/ableview-moments.companionconfig`.
3. Commit the export so other rigs can **Import → Buttons → insert page** and remap the AbleView
   connection.

See [`companion/README.md`](../companion/README.md) for import steps.

**Future:** a dedicated `companion-module-ableview` would give connection-level host/port, a `who`
dropdown, and native feedback variables without manual variable wiring.
