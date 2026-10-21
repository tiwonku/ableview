# M17 — Set-local cue rows

One-off titles that belong to a named set, not to the cue sheet. They carry the same
column names the views already read (`Key`, `BPM`, `RGB_1`, `Viz Notes`, and the rest),
so Band, Lighting, and Visuals do not learn a second schema. They enter the matcher
only while that set is the active one. They are never written to Google.

Sheet-backed setlist rows stay what M15 built: an ordered list of cue-sheet `rowId`s.
This plan adds a second kind of item on the same list.

**Related:** [`M15-setlist.md`](./M15-setlist.md), [`src/setlist/index.js`](../../src/setlist/index.js),
[`src/match/index.js`](../../src/match/index.js), [`src/core/cue-payload.js`](../../src/core/cue-payload.js),
view field maps in [`config/config.example.json`](../../config/config.example.json),
[`public/shared/admin-row-editor.js`](../../public/shared/admin-row-editor.js).

---

## Goal

- From the Set page, add a title that is not a cue-sheet row and will not become one.
- Store any sheet column on that item, using the header string the field maps already use.
- While that set is active, a playing clip matches the local row the same way it matches a sheet row, and operator views render the local cells.
- Switching to another set removes those titles from the match index. A later show cannot fuzzy-match a swirl that lived on last weekend's list.
- Edit, pin, and Flash write the local item. They do not call the Google row APIs.

## Non-goals

- A second Google tab, a "do not match" column, or rows that sit in `data/sheet-cache.json` but are skipped.
- Indexing every file in `data/setlists/`. Inactive lists are inert, including after Save as / Duplicate.
- Lowering the match threshold for local rows. NFR-7 is unchanged: a below-threshold clip stays unmatched.
- Auto-pin, played-advance, or persisting a pin across restart (still M15).
- New view field types. `column: "Viz Notes"` already means `payload.row["Viz Notes"]`.
- Promoting a local row into the cue sheet. That can be a later slice; v1 leaves the cells on the set file.

---

## What exists

A setlist item is `{ rowId, title, status }`. `addItem` rejects a `rowId` that is not on the sheet. `normalizeItem` drops every other property on load, so a `fields` object would not survive a restart until that function keeps it.

`hydrateItem` copies `Key`, the ALS folder, and the configured RGB columns off the sheet row. A missing sheet row is flagged `missing`. Pin (`applyPinnedRow`) and the matcher (`buildSearchItems`) only see `snapshot.rows`.

Operator views never read the setlist. They read `CuePayload.row`, which is the sheet row's `data` object, then pick cells by the `column` string in the view field map. The row editor and Flash both `PATCH /api/sheets/rows/:rowId`.

The live tempo chip (`source: "tempo"`) is Ableton's tempo. The sheet `BPM` cell is a separate field. A local row can store `BPM`; it does not replace the live tempo readout.

---

## Row shape

Sheet items stay as they are. Local items add `fields`, a flat map of **sheet header → cell string**. Keys are the same strings as `views.*.fields[].column` and `sheets.editorColumns` (`"Song Title"`, `"Key"`, `"BPM"`, `"Viz Notes"`, `"RGB_1"`, …). Cell text uses the formats the sheet already uses (`255, 0, 0`, a BPM number as text). No parallel `key` / `bpm` / `colors` struct.

```json
{
  "rowId": "local:7f3a1c2e",
  "title": "Always a Good Day",
  "status": "confirmed",
  "fields": {
    "Song Title": "Always a Good Day",
    "Key": "Am",
    "BPM": "98",
    "Viz Notes": "one-off swirl, Saturday only",
    "RGB_1": "255, 0, 80",
    "RGB_2": "80, 0, 255",
    "RGB_3": "255, 220, 0"
  }
}
```

- `rowId` is `local:` plus a short id. Sheet ids stay the numeric strings Google already uses, so the two cannot collide.
- `fields[matchColumn]` is required. `title` is a copy of that cell, updated on every edit, so `readSetlistClipNames` and the Set page keep working.
- Persist non-empty cells only. Readers treat a missing key as `""`.
- `fields` on a sheet `rowId` is ignored. The sheet row remains the source for that item.
- `normalizeItem` must keep `fields` for `local:` ids and drop them for sheet ids.

`hydrateItem` for a local id does not look at the sheet. `liveTitle`, `key`, and `colors` come from `fields` using `matchColumn`, `"Key"`, and the same RGB columns the glance already uses. `missing` is false. The badge is "This set", not "Missing from sheet".

---

## Match scope

`buildSearchItems` gains the active set's local rows beside the sheet rows. Each local item is passed in as `{ rowId, data: fields }`. Alias and ALS-folder indexing use those cells when present, same as a sheet row. Prefix pass, Fuse floor, token overlap, and the extra-word guard are unchanged.

Only the **active** set contributes. Switch, delete, or a local add / edit / remove rematches the current clip, the same way a sheet sync does. Other JSON files in `data/setlists/` are not opened for matching.

A clip that exactly matches a local title resolves to that local row. A clip that exactly matches a sheet title still resolves to the sheet row. When two different rows are merely close, the existing confidence gap applies: if they are too close, the cue is unmatched rather than a guess.

Session log `match` lines may record `rowId: "local:…"`. That id is not a sheet coordinate and must not be sent to Google.

---

## Views, editor, Flash

`makeCuePayload` already ships `row` through to every view. For a local hit, `row` is `fields`. Existing field maps then show Viz Notes, colors, key, and BPM with no view changes.

Pin must resolve `local:` ids from the active set inside `applyPinnedRow` (today it returns null unless the id is on the sheet snapshot). Clearing the pin is unchanged.

The row editor already collects changes by column name (`collectEditorChanges` → `validateAndFormatChanges`). Saving a `local:` id writes the formatted cells onto that setlist item and rematches. It does not `PATCH` Google. View `editable` flags still decide which columns an operator view may change. The Set page can edit the full `editorColumns` set, same as admin.

Flash copies live GrandMA RGB into `RGB_1` / `RGB_2` / `RGB_3` of the matched row. On a local match those three cells update the setlist item.

Add-as-alias, if used on a local row, appends to that item's `Aliases` cell. It does not append to the sheet.

---

## API and UI

| Method | Path | Action |
|---|---|---|
| `POST` | `/api/setlist/local-items` | `{ fields, status? }` creates a `local:` item on the active set. `fields[matchColumn]` required. |
| `PATCH` | `/api/setlist/local-items/:rowId` | `{ fields }` merges cells. Match-column edits refresh `title`. |
| `DELETE` | `/api/setlist/items/:rowId` | Already removes by id. Works for `local:` ids. |

`GET /api/setlist` includes `fields` and `local: true` on those items so the client does not have to guess from the id prefix. Sheet items omit `fields`.

Cue-sheet search stays sheet-only. Local titles are already on the set; they should not appear as if they lived in Google.

On the Set page, the quick-create block (the one that already offers a new cue-sheet row when the typed title is not an exact hit) gains a second action, **This set only**. It posts `local-items` with the title and key, leaves the other columns empty, and does not call `POST /api/sheets/rows`. **Add to set** / the cue-sheet path stays for songs that should enter the permanent pool. Edit on a local row opens the existing editor against `fields`.

---

## Acceptance

- A local "Always a Good Day" with key, BPM, colors, and Viz Notes, on the active set, matches that clip and those cells show on Band, Lighting, and Visuals.
- The same clip with a different set active does not match the local row. It may still match a real sheet row under the current rules.
- "Good Day" on the sheet and "Always a Good Day" local, both present, still resolve to their own rows on an exact clip name.
- A below-threshold clip stays unmatched (NFR-7).
- Edit, Flash, and pin on the local row survive a process restart and do not change the Google sheet or `data/sheet-cache.json`.
- Restart reloads the local item. Save as / Duplicate copies it onto the new file, where it matches only after that file is the active set.
- `npm test` green. NFR-1 unchanged.

## Build slices

One slice per session.

1. **Storage.** Extend `normalizeItem` / `hydrateItem`. `POST` local items. Glance shows key and colors from `fields`. No matcher change yet.
2. **Match and pin.** Active local rows join `buildSearchItems`. Set switch and local edits rematch. `applyPinnedRow` resolves `local:` ids. Tests for exact separation, inactive-set exclusion, and NFR-7.
3. **Editor and create.** "This set only" on the Set page. Row editor, Flash, and alias-append branch on `local:` and write the set file.
