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

1. **Custom variables** → add `moment_who` (default e.g. `keys`).
2. Same button setup as above, but body:

```json
{"kind":"dope","who":"$(custom:moment_who)"}
```

3. Change `moment_who` in Companion when a different person uses the deck.

Variable names are yours to choose — `moment_who`, `moment_feedback`, etc. work fine. The examples
below use that naming.

---

## 3. Button feedback (green / yellow / red)

Generic HTTP does not paint the Stream Deck key from HTTP status codes alone. The working pattern is:

1. A **state variable** (`moment_feedback`) holding short strings like `pending` / `success`
2. **Press actions** that update that variable from the POST response
3. **Feedbacks** on the button that change background color when the variable matches

Put all press actions inside an **Internal → Action group: Sequential** block (Companion 3.5+) so
each step finishes before the next runs.

### Custom variables (create once)

| Variable | Holds | Must NOT hold |
|---|---|---|
| `moment_who` | Crew label (`keys`, `bass`, …) | JSON |
| `moment_response` | Raw POST JSON (stored by the HTTP action) | state words |
| `moment_feedback` | Only `pending`, `success`, `warning`, `error`, or empty | JSON or expression text |

| `moment_feedback` value | Button color | Meaning |
|---|---|---|
| `pending` | Yellow | Press sent, waiting for response |
| `success` | Green | Moment logged |
| `warning` | Amber | Debounced double-tap (HTTP 429) |
| *(empty)* | Black | Idle / after flash timeout |
| `error` | Red | Rejected (409 strict mode, bad kind, network down) |

### Press actions (sequential group)

Add these **in order** inside **Action group: Sequential**:

**1. Set pending (plain text — expression mode OFF)**

- **Internal → Custom variable: Set value**
- Variable: `moment_feedback`
- Value: `pending`

**2. POST the moment (capture response here — no separate GET needed)**

- **AbleView → POST**
- URI: `/api/moments`
- Body: `{"kind":"dope","who":"$(custom:moment_who)"}` (or hardcoded `who` from §2)
- **JSON Response Data Variable:** `moment_response`
- **JSON Stringify Result:** leave **unchecked**
- **Response Status Code Variable:** optional (not required for colors)

The POST body includes `feedbackState: "success"` on HTTP 200. You do not need a follow-up GET —
GET `/api/moments` is for health checks and does not include `feedbackState`.

**3. Set success or error (expression mode ON)**

- **Internal → Custom variable: Set value**
- Variable: `moment_feedback`
- Click the **expression button** (√x icon, right of the Value field) so the field evaluates
  JavaScript — this is **not** a separate action in all Companion builds; it is expression mode on
  **Set value**
- Value (expression):

```
jsonpath($(custom:moment_response), "$.ok") ? 'success' : (jsonpath($(custom:moment_response), "$.feedbackState") || 'error')
```

Use a **truthy** check on `$.ok` — `=== true` often fails because `jsonpath` may return a string.

While editing, the preview badge may show `error` because `moment_response` is empty until you
press the button. That is normal.

**4. Flash back to black (~1 s) — optional**

- **Internal → Wait** (or **Delay**) — **1000** ms
- **Internal → Custom variable: Set value** — `moment_feedback` = *(empty)*, expression mode OFF

When `moment_feedback` is empty, no color feedback matches and the button returns to the **Style**
tab default (set background to black there).

### Simple fallback (no expression)

If expression parsing is fighting you, steps 1–2 plus a plain third step still gives yellow → green:

3. **Custom variable: Set value** — `moment_feedback` = `success` (no √x)

You lose automatic red on HTTP errors until you add the expression back.

### Button feedback (Feedbacks tab)

On the same button, **Style** tab: set default background to **black** (`0` or `#000000`).

**Feedbacks** tab — add **Internal → Check custom variable** (one rule per row; put `pending`
above `success` so yellow wins on press):


| Variable | equals | Background | Decimal RGB |
|---|---|---|---|
| `moment_feedback` | `pending` | yellow | `3491840` |
| `moment_feedback` | `success` | green | `34816` |
| `moment_feedback` | `warning` | amber | `3491840` |
| `moment_feedback` | `error` | red | `8912896` |

Hex (`#008800`) works in some builds; use decimal if colors do not appear.

Do **not** point feedback rules at `moment_response` — that variable holds JSON, not state words.

### Common mistakes


| Symptom | Cause | Fix |
|---|---|---|
| `moment_feedback` contains `{"ok":true,...}` | GET/POST response stored in wrong variable | Store JSON only in `moment_response` |
| `moment_feedback` contains `jsonpath({"ok":...` | Expression typed with √x **off** | Toggle √x on; value must evaluate, not substitute |
| Preview / variable stays `error` but logging works | `=== true` in expression | Use truthy `jsonpath(..., "$.ok") ? 'success' : ...` |
| Button stays yellow | Step 3 never runs or never sets `success` | Check Sequential group; verify variable after press |
| Button green but never clears | Missing wait + empty step | Add §3 step 4 |
| Using **Logic: If statement** + Variable check | Wrong tool for JSON fields | Use expression on **Set value** instead |

### API `feedbackState` field

POST responses include a machine-readable state for Companion parsing:


| HTTP      | `feedbackState` | Typical cause                     |
| --------- | --------------- | --------------------------------- |
| 200       | `success`       | Moment appended                   |
| 400 / 409 | `error`         | Bad kind, strict mode, validation |
| 429       | `warning`       | Debounce suppressed duplicate     |


Success body also includes `momentCount` (moments in the active session file).

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
| Button stays yellow | Step 3 not setting `success`; see §3 common mistakes |
| Colors never change | Feedbacks must check `moment_feedback`, not `moment_response` |
| Logging works, colors don't | POST **JSON Response Data Variable** must be `moment_response`; step 3 needs √x expression mode |
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

**GET** `/api/moments` — probe for Companion feedback scripts:

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
