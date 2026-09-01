# M15 — Setlist editor / viewer

Night-specific **ordered subset of cue-sheet rows**. Operators glance at songs that are
known or suspected for the show, and can **pin** a row onto the live board using the
existing override (`POST /api/match/override`).

The setlist is **not** a match source. Pinning still means “show this row as the live cue
until the next automatic match.”

## Goal

- Add / reorder / remove sheet rows on a named setlist.
- Persist across process restart (show-box reboot).
- Save / recall other named setlists (festival vs club vs rehearsal).
- Dedicated `/views/setlist` for glance + edit.
- One-tap **Pin** / **Clear pin** from a list row.

## Non-goals

- Auto-pin next song.
- Using the setlist as a fuzzy-match source (NFR-7 unchanged).
- Linear “played” auto-advance (DJ sets skip around).
- Duplicating cue-note columns into the setlist file (store `rowId` + cached title).
- Persisting pin state across restart.
- Embedding the full list on Band / Lighting / Visuals.

## Storage

Same pattern as session logs: named files + a gitignored sidecar.

```
data/setlists/
  .active.json              # which list is loaded (gitignored)
  default.json
  festival-saturday.json
```

Each file:

```json
{
  "name": "festival-saturday",
  "updatedAt": "2026-09-01T18:40:00.000Z",
  "items": [
    { "rowId": "12", "title": "Song A", "status": "confirmed" },
    { "rowId": "7", "title": "Song B", "status": "likely" }
  ]
}
```

`status` is `confirmed` | `likely` | `maybe`. Edits write through immediately.
Active name is **not** stored in `config.json`.

Config:

```json
"setlist": {
  "directory": "./data/setlists",
  "defaultName": "default"
}
```

## API

| Method | Path | Action |
|---|---|---|
| `GET` | `/api/setlist` | Current list + `library` |
| `PATCH` | `/api/setlist` | `{ name }` switch; `{ name, create: true }`; `{ name, duplicate: true }`; `{ order: rowIds }` |
| `POST` | `/api/setlist/items` | `{ rowId, status? }` |
| `PATCH` | `/api/setlist/items/:rowId` | `{ status }` |
| `DELETE` | `/api/setlist/items/:rowId` | Remove |

WebSocket: `init.setlist` and `{ type: "setlist", setlist }` on change. `CuePayload` is unchanged; the client correlates `match.rowId` for the **Now** highlight.

## UI

`/views/setlist` (system view): live-cue banner, named-list switcher, search-add from the cue sheet, ordered rows with status / pin / remove.

Pin copy on the page: the list is tonight’s plan; pin only when the live board should show that row.

## Acceptance

- Kill and restart the process → same named setlist and items.
- Save as / switch → other files on disk; sidecar points at the loaded name.
- Below-threshold live match does **not** highlight a setlist row (NFR-7).
- Pin from a row uses the existing override and clears on the next auto match.
- `npm test` green; NFR-1 tests unchanged.
