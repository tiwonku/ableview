# AbleView → show capture

Handoff for the AbleView side. The website keeps a copy of the JSONL as the show happens. The local file remains the log. Nobody picks a show id in AbleView.

The route is specified here and is **not deployed yet**. Build the sender against this contract. Point it at a URL only after that URL is sent with the secret.

---

## What you keep doing

On each log line, append one JSON object to the local JSONL and return. That append is the hot path. It does not wait on the network, DNS, or this website.

A separate sender thread drains a queue of those same objects. If the network is down for the whole night, the file is still complete, and the file can be uploaded later. The live push is a copy.

## What you add

When you append a line, set two fields on the object **before** it hits the file and **before** it is queued:

| Field | Rule |
| --- | --- |
| `seq` | Integer. `1` for the first line of this `sessionName`, then `2`, `3`, … Never reused, never going backwards, including across an AbleView restart in the same session. |
| `lineId` | String, 1–128 characters, unique for this `sessionName`. The decimal form of `seq` (`"1"`, `"2"`, `"42"`) is fine. |

`sessionName` stays what it is today. One name for the whole file. Do not rotate it mid-show. Do not reuse a previous night’s name: lines with the same name are one session on the site. Two machines posting at the same time need different `sessionName` values.

Leave every other field as you already write it (`timestamp`, `event`, `loggedAt`, and the rest). The site stores the object whole.

Example, same shape as a current line plus the two fields:

```json
{"seq":1042,"lineId":"1042","timestamp":"21:43:27;15","timestampSource":"artnet","loggedAt":"2026-08-11T02:43:27.475Z","event":"track_clip","trackIndex":16,"trackName":"DECK F","clipName":"MGMT 01","slotIndex":298,"authoritativeClip":null,"tempo":90,"beat":1349,"pendingLaunch":false,"simulated":false,"sessionName":"cap-night-2-set1"}
```

Events the site already understands, unchanged: `launch`, `track_clip`, `match`, `moment` (`kind` `dope` or `typed`), `live_color`. Other events can still be posted. They are stored and skipped when the timeline is built.

---

## Config

Two values, in AbleView’s settings or a file beside the app. Not compiled into a build. Not in git.

| Setting | Value |
| --- | --- |
| Capture URL | Sent with the secret. It will be `https://<site>/api/show-capture`. |
| Capture secret | One string for the tour. Same value on the website. Rotate only when a laptop is retired. |

You do not get a database URL or a database key. You do not get a new secret per night. You do not send a show id.

---

## POST

`POST` the capture URL.

Headers:

```
Authorization: Bearer <capture secret>
Content-Type: application/json
```

Body:

```json
{ "lines": [ { } ] }
```

`lines` is an array of the raw objects, in `seq` order. One `sessionName` per request. At most **200 lines**. Body at most **1 MB**.

Send about one batch a second while lines are queued. Stay under **30 requests in a minute**. A show does not need more than that: a full Cap set was about 2,300 lines over two hours and forty minutes.

### Responses

| Status | Meaning | What the sender does |
| --- | --- | --- |
| 200 | `{ "ok": true, "inserted": N, "alreadyStored": M }` | This batch is done. Drop it from the queue. `alreadyStored` means those `lineId`s were already accepted, which is what a retry looks like. |
| 400 | The body will never succeed as sent (empty, missing `sessionName` / `lineId` / `seq`, mixed session names, `seq` going backwards, over 200 lines or 1 MB). | Do not retry that body. Surface it. Keep the local file. |
| 401 | Secret missing or wrong. | Stop sending. Surface it. Do not hammer. |
| 409 | A `seq` in this session is already stored under a different `lineId`. | Stop that session’s sender and surface it. The file and the copy have diverged. |
| 429 | Over 30 requests in a minute. | Keep the batch. Wait at least 2 seconds, then retry the same body. Back off up to a minute. |
| 408, 429, 5xx, or a timeout | The copy did not confirm. | Keep the batch. Retry the same body with the same backoff. Never invent new `lineId`s for a retry. |

Treat the request as failed if there is no 200. A dropped connection after the server accepted the batch is safe: the retry comes back `alreadyStored`.

Insert order inside a batch follows the array. Timeline order on the site follows `seq`, not the time the request arrived, so a late retry of an earlier batch does not scramble the night.

---

## What the website does with the lines

Nothing in AbleView attaches a line to a night or to a video.

Lines sit in an inbox under `sessionName`. After the show, someone on the site confirms which night that session was. That confirm is what builds the timeline. Pasting the video later does not require another push.

If the push missed lines, the local JSONL can be dropped on the site later. The site adds any `lineId` the inbox does not have and rebuilds one timeline. It does not stack a second copy of the markers. That only works if `lineId` and `seq` in the file are the ones you posted.

---

## Done when

- A log line is on disk before any HTTP call starts.
- Unplugging the network loses no lines from the file, and the sender catches up when the network returns.
- Posting the same batch twice does not create duplicate `lineId`s.
- `seq` survives a restart and keeps increasing for that `sessionName`.
- The secret and the URL can be changed without rebuilding AbleView.
