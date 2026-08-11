# Companion setup — Moments (Stream Deck)

Crew members mark **moments** in the show timeline via Stream Deck buttons. AbleView stamps each
tap into the active **session log** JSONL with an Art-Net SMPTE timestamp (when live).

**API:** `POST /api/moments` on the AbleView show box (same host/port as operator views).

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

1. **Buttons** tab → pick an empty key.
2. **Button text:** `DOPE` (or your preferred label).
3. **Press actions** → **AbleView** connection → **POST**.
4. **URL path:** `/api/moments`
5. **Body** (JSON):

```json
{"kind":"dope","who":"keys"}
```

Replace `"keys"` per person or deck (`"bass"`, `"drums"`, `"foh"`, …). Omit `"who"` for anonymous.

6. Click **Test** (▶). Expect **HTTP 200**.

### First tap while session logging is off

When **Auto-start session log on first moment tap** is enabled (default), the first press:

- Creates a new session file named like `2026-08-11_211504.jsonl`
- Returns `"sessionLogStarted": true` in the JSON response
- Updates **Log: …** in the status bar on all open operator views (no refresh)

---

## 3. "NOT DOPE" button (future)

1. In AbleView **Settings**, add `not_dope` to **Allowed kinds** (or edit `moments.kinds` in
   `config.json`).
2. Duplicate the DOPE button.
3. Change label and body:

```json
{"kind":"not_dope","who":"keys"}
```

No AbleView code change required.

---

## 4. Strict mode (optional)

To **require** session logging to be enabled before moments work:

1. Settings → **Moments** → uncheck **Auto-start session log on first moment tap**.
2. Enable logging manually on the **Session log** panel first.
3. Buttons return **409** if logging is still off.

---

## 5. Troubleshooting

| Symptom | Check |
|---|---|
| HTTP connection failed | Show box IP, firewall, `HTTP_PORT`, AbleView running |
| 409 `session_log_disabled` | Enable session log in Settings, or turn auto-start back on |
| 400 `unknown_kind` | Add the kind to **Allowed kinds** in Settings |
| Operator views don't show log name | Page must be open on the show box URL; check WebSocket connection dot |

---

## 6. Response reference

**200 OK**

```json
{
  "ok": true,
  "timestamp": "01:23:45:12",
  "timestampSource": "artnet",
  "loggedAt": "2026-08-11T21:15:04.512Z",
  "kind": "dope",
  "who": "keys",
  "sessionName": "2026-08-11_211504",
  "sessionLogStarted": true
}
```

**GET `/api/moments`** — probe for Companion feedback scripts:

```json
{
  "ok": true,
  "sessionLogEnabled": true,
  "sessionName": "2026-08-11_211504",
  "kinds": ["dope"],
  "lastMoment": { "loggedAt": "...", "kind": "dope", "who": "keys" }
}
```
