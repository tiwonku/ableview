# M16 — Palette view module (3-color harmony)

Build plan for a **droppable view field** that shows and edits a **2–3 color look** as one
module — linked hues, harmony presets, 60/30/10 hierarchy — using the Ablecolor Selecta
*interaction model* without porting Selecta’s desktop UI.

Today each RGB cell is its own `type: "color"` field. Palette is the next field type in
that same map: you add one entry to `views.<id>.fields` and it appears on that view.
During rollout it can sit **next to** the existing color fields. Once it is trusted on
the short operator bars, it **replaces** those three color entries.

Selecta lives beside the sheet as a workshop tool (`c:\dev\2026\ablecolor-selecta`).
AbleView writes the live sheet from kiosk browsers on **wide, short** displays (e.g.
Xeneon Edge 2560×720). Those constraints drive layout. Do **not** copy
`ablecolor-selecta/renderer/index.html` into this repo.

**Agent workflow:** one sub-milestone (M16a–M16d) per session/commit. Run `npm test`
after each stage. Verify M16b+ on a **short viewport** (2560×720 or a window forced
to ~720px tall), not only a tall laptop screen.

**Related:** view field maps ([`config/config.example.json`](../../config/config.example.json)),
[`public/shared/field-display.js`](../../public/shared/field-display.js),
[`public/shared/view-render.js`](../../public/shared/view-render.js),
[`public/shared/color-picker.js`](../../public/shared/color-picker.js),
[`public/shared/color-parse.js`](../../public/shared/color-parse.js),
[`public/shared/admin-row-editor.js`](../../public/shared/admin-row-editor.js),
[`public/shared/sheet-format.js`](../../public/shared/sheet-format.js),
[`ROADMAP.md`](../../ROADMAP.md), [`AGENTS.md`](../../AGENTS.md).
Selecta spec: `ablecolor-selecta/BUILD-BRIEF.md` (harmony math, 60/30/10, RAINBOW,
output format).

---

## 1. Goal and non-goals

### Goal

- Add a first-class view field type **`palette`**: one module bound to 2–3 sheet color
  columns (usually `RGB_1` / `RGB_2` / `RGB_3`). Drop it on Lighting, Visuals, Band, or
  a future view the same way you drop `type: "color"` or `type: "image"` today.
- **Read mode:** the module is the look — 60/30/10 bar plus slot chips — not three
  unrelated cards that happen to sit in a row.
- **Edit mode:** one overlay edits every slot in that module. Dragging **primary**
  rotates still-linked secondaries; dragging a secondary unlinks it; a preset re-links.
- Done writes all bound cells through the **existing** row-editor save path
  (`collectEditorChanges` → `validateAndFormatChanges` → `PATCH /api/sheets/rows/:id`).
  Output stays **`R, G, B`** with comma **and space** (load-bearing for Sheets).
- `type: "color"` stays. Palette does not delete it. Cutover is a **config** change:
  remove the three color field entries once the module is good enough.
- First engine is **HSL**. OKLCH + RYB are a later slice, not a v1 requirement.

### Non-goals

- Porting Selecta’s square wheel, track library, clipboard “COPY ALL 3”,
  always-on-top, Electron shell, or `renderer/index.html`.
- Removing `color-picker.js` in v1 (single leftover `type: "color"` columns still need it).
- Guessing which harmony an existing sheet row was “meant” to be.
- Live `PATCH` while dragging.
- New npm dependencies (vanilla math only).
- Admin GUI for view field maps (still edit `config.json` — same M7 note).
- Changing NFR-1, matcher, or CuePayload shape.
- Writing to Ableton or to Selecta’s `palettes.json`.
- Google Sheets cell-fill / background color.

---

## 2. Problem statement

### What exists

View fields are already droppable modules. A view is an ordered list:

```json
{ "column": "RGB_1", "label": "Color 1", "type": "color" }
```

`groupFieldsForLayout` then **infers** a `colors` row from consecutive `type: "color"`
entries. That grouping is a display convenience, not a first-class module. Each card
still opens a **one-color** overlay (`openColorPicker`).

Sheet cells stay independently typed in `sheets.editorColumns` (`RGB_1` / `RGB_2` /
`RGB_3` → `color`). That is correct: the sheet is three columns. The *view* is what
should know they are one look.

Operator CSS already special-cases **wide and squat** color cards. ROADMAP:
“ultrawide and short displays (e.g. Xeneon Edge 2560×720)”.

### Gaps

| Gap | Impact |
|---|---|
| No view-level “look” type | You cannot put a palette on Band or a spare view without also inventing three color cards |
| Consecutive colors are inferred | Layout and edit UX are coupled to field *order*, not to an explicit module |
| One slot at a time | Building a look means three modal trips; no linked rotation |
| No harmony / 60/30/10 | Operators do Selecta math in their head, or leave the board |

Selecta solved the workshop problem. This milestone solves the **on-board** problem
by making the look a module you can place, the same way you place a note or an image.

---

## 3. Architecture

### 3.1 Palette is a view field, not a sheet type

| Layer | What it knows |
|---|---|
| **Sheet** | Three cells. `editorColumns.RGB_*` stay `{ "type": "color" }`. Formatters unchanged. |
| **View field map** | Zero or more `{ "type": "palette", "columns": [...] }` entries, plus any remaining `type: "color"` fields. |
| **Renderer** | `palette` → one module. `color` → today’s swatch card. Both can appear on the same view. |

No new REST routes. No WebSocket message types. `init.fields` already sends
`viewConfig.fields`; the client learns the new type from that array.

```
views.<id>.fields
  ├─ { type: "color", column: "RGB_1" }     // stays valid
  ├─ { type: "palette", columns: [...] }    // NEW module
  └─ { column: "Lasers" }                   // unchanged

Read:  renderPaletteField(field, payload)
Edit:  openPaletteEditor({ columns, values })
Done:  write hex | RAINBOW | "" into each bound color widget
Save:  existing collectEditorChanges / PATCH
```

### 3.2 Config shape

Palette is the first field that binds **multiple sheet columns**. Config validation
today requires `field.column` unless `source: "tempo"`. Relax that when
`type === "palette"`: require `columns` (2–3 non-empty header strings) and
**do not** require `column`.

```json
{
  "type": "palette",
  "label": "Palette",
  "columns": ["RGB_1", "RGB_2", "RGB_3"]
}
```

| Key | Required | Notes |
|---|---|---|
| `type` | yes | `"palette"` |
| `columns` | yes | 2 or 3 sheet headers, order = slot order (60 / 30 / 10) |
| `label` | no | Default `"Palette"` |
| `column` | no | Reject if set — avoids “which column is the field?” ambiguity |

Slot roles:

| Index | Role | Weight | Typical column |
|---|---|---|---|
| 0 | PRIMARY | 60% | `RGB_1` |
| 1 | SECONDARY | 30% | `RGB_2` |
| 2 | ACCENT | 10% | `RGB_3` (omit if only two columns) |

A view may include **more than one** palette (unusual, but the type should not
assume a singleton). Two palettes must not share a column on the same view —
validate and reject.

### 3.3 Coexistence and cutover

**During M16b (example config):** add a palette field to **one** operator view
(Lighting is the natural first) **instead of** its three color entries *or* keep
the three color entries on Visuals so both modules can be compared on the same
box. Do **not** put a palette *and* `type: "color"` fields for the same columns
on the same view — that doubles the look.

Recommended transition:

1. M16b ships; `config.example.json` documents the palette field.
2. Local `config.json`: Lighting uses `{ type: "palette", columns: ["RGB_1","RGB_2","RGB_3"] }`;
   Visuals keeps the three `type: "color"` cards.
3. After real-bar time, Visuals (and any other view) swap the three color
   entries for one palette entry.
4. `type: "color"` remains for a **single** leftover color column if a show ever
   has one.

Cutover is config only. No data migration. Sheet columns do not change.

### 3.4 Module split

| Module | Path | Role |
|---|---|---|
| Harmony math | `public/shared/color-harmony.js` | Offsets, link/unlink, HSL apply; later OKLCH/RYB/gamut |
| Palette field | `public/shared/palette-field.js` (or `view-render` helpers) | Read-mode module + edit-mode widgets for the bound columns |
| Palette overlay | `public/shared/palette-editor.js` | Wide/short dialog; pointer thumbs; presets |
| Existing picker | `public/shared/color-picker.js` | Single-slot HSV for remaining `type: "color"` fields |
| Layout | `public/shared/field-display.js` | `groupFieldsForLayout` grows `{ type: "palette", field }` — do not fold palette into a `colors` row |
| Parse / format | `color-parse.js`, `sheet-format.js` | Unchanged contracts |
| Config | `src/config/index.js` | Validate `type: "palette"` + `columns` |
| Wiring | `view-render.js`, `admin-row-editor.js`, `ws-client.js` | Render module; open overlay after mount |
| CSS | `public/shared/styles.css` | `.palette-field-*`, `.palette-editor-*`, short-viewport rules |

Selecta’s renderer stays in the other repo. Copy **formulas and tests**, not DOM.

### 3.5 Design principles

1. **Same drop point as every other field.** If it cannot live in `views.*.fields`,
   it is not done.
2. **Bar-native layout, Selecta behavior.** Linked drag, presets, 60/30/10, unlink.
   Geometry is a hue **strip** and a horizontal slot row, not a square disc.
3. **`color` stays until cutover.** Single-slot picker is the fallback and the
   editor for any remaining color field.
4. **Existing rows start unlinked.** A preset is an explicit action.
5. **One write at Done.** Overlay state is local until the operator confirms.
6. **Same save pipeline.** Never invent a second color formatter.
7. **No new deps.** Math is vanilla JS, covered by `node:test`.

---

## 4. Open decisions (defaults for implementation)

| ID | Topic | Default for M16 |
|---|---|---|
| OD-P1 | `type: "color"` | **Keep.** Palette is additive. Cutover is removing color entries from a view’s field list. |
| OD-P2 | v1 geometry | **Horizontal hue strip** with 2–3 thumbs + 60/30/10 bar. Square wheel is M16d / later. |
| OD-P3 | v1 engine | **HSL only.** OKLCH + gamut-map + RYB = M16c. |
| OD-P4 | Load existing sheet colors | **Unlinked.** Do not infer nearest preset. |
| OD-P5 | Field identity | **`columns` array**, no `column`. Config rejects `column` on palette fields. |
| OD-P6 | Slot order | `columns[]` order = 60 / 30 / 10. Do not special-case names; `RGB_1` first is convention, not code. |
| OD-P7 | Sheet writes while dragging | **None.** Preview in overlay only. |
| OD-P8 | Cancel | Restore **all** bound slots in the snapshot. |
| OD-P9 | Rainbow | **v1 = current AbleView token** (`RAINBOW` replaces the cell). Selecta-style “flag over preserved HSV” is M16c if cheap. Harmony skips rainbow slots. |
| OD-P10 | Empty slots | Allowed. A preset may fill an empty linked slot. Clear-all is explicit. |
| OD-P11 | Edit entry | Tap the palette module (or an **Edit palette** control on it) starts the same edit session as today’s Edit / swatch tap, then opens the overlay. Individual slot chips do **not** open the single-slot picker when they belong to a palette. |
| OD-P12 | Admin page | **Out of v1** as a placed module. Admin row editor still uses per-column color widgets (native `<input type="color">` or the single-slot picker). |
| OD-P13 | Track library / clipboard | **Out of scope.** AbleView already saves the row. |
| OD-P14 | NORMALIZE | **Do not add** (Selecta removed it; it fights brightness). |
| OD-P15 | Extra palette config | **None required for v1.** Preset list is a constant. Later optional: per-field `presets`, `engine`. |
| OD-P16 | Touch | Thumbs ≥ current picker thumb (`1.7rem`); `touch-action: none`; pointer capture like `color-picker.js`. |
| OD-P17 | Live cards behind overlay | **Do not mutate** row-editor widgets until Done. |
| OD-P18 | Same columns twice | **Reject** a view that lists the same header in two palette `columns` arrays, or in a palette **and** a `type: "color"` field. Fail at config validate. |
| OD-P19 | Example cutover | Lighting example in `config.example.json` becomes one palette field in M16b. Visuals example may keep three color fields until M16b has been used on a bar. |

---

## 5. Behavior

### 5.1 Read-mode module

One field in the strip/hero, not three `field-color` cards:

```
┌─ Palette ──────────────────────────────────────────────────────────────┐
│  [======== 60% ========][==== 30% ====][= 10% =]                       │
│  ① 255, 0, 80          ② 232, 156, 255         ③ 0, 120, 216         │
└────────────────────────────────────────────────────────────────────────┘
```

- Occupies one layout slot (like `type: "image"`), spanning the row on short
  bars so the 60/30/10 bar can actually read as a look.
- Copy RGB / hex can live on the slot chips (same helper as today’s color cards).
- Empty slots use the existing empty-swatch treatment. Rainbow slots use the
  existing gradient.
- `groupFieldsForLayout` emits `{ type: "palette", field }` and does **not**
  merge adjacent `type: "color"` fields into this module.

`resolveFieldsLayoutMode`: a palette counts as “has a wide module” the same way
a color field forces `strip` today (or a dedicated rule — don’t let a Band view
that only added a palette collapse into three-token hero).

### 5.2 Overlay chrome (v1)

Designed for ~2560×720 and any `layout-operator` short height:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Palette          [Clear all]                              [Cancel] [Done] │
├─────────────────────────────────────────────────────────────────────────┤
│  [======= hue strip · thumbs 1 / 2 / 3 =======]   [ 60% | 30% | 10% ]   │
├─────────────────────────────────────────────────────────────────────────┤
│  [TRIAD] [COMPLEMENT] [ANALOGOUS] [SPLIT-COMP] [TIGHT] [TETRAD] [MONO]   │
├─────────────────────────────────────────────────────────────────────────┤
│  ① PRIMARY 60%     ② SECONDARY 30%      ③ ACCENT 10%                     │
│  [swatch]          [swatch]             [swatch]                         │
│  RGB / hex         RGB / hex            RGB / hex                        │
│  Rainbow · Clear   Rainbow · Clear      Rainbow · Clear                  │
│  (slot 1 linked)   🔗 / 🔓              🔗 / 🔓                           │
└─────────────────────────────────────────────────────────────────────────┘
```

- Hue = position along the strip (0° red at left, increasing X = clockwise).
  Document that convention in the module header and keep it consistent.
- Slot 1 thumb is largest; 2 medium; 3 smallest (Selecta role sizing).
- Drag slot 1: linked 2/3 keep angular offsets.
- Drag slot 2 or 3: that slot unlinks; others unchanged.
- Preset: set offsets from slot 1, re-link 2/3, apply HSL. Slot 1 hue stays
  unless the slot was empty (then use today’s picker `EMPTY_START`).
- 60/30/10 bar is display-only in v1 (not a drag target).
- Optional quiet warning line (hue collision / near-black) — nice-to-have in
  M16b, not a blocker.

Portrait / narrow (`max-width: 40rem`): stack hue strip above the bar; slots
stay a 3-col grid if width allows, else horizontal scroll of slots — **do not**
collapse to one column of three full pickers.

### 5.3 Harmony offsets (from Selecta)

| Preset | Slot 2 | Slot 3 |
|---|---|---|
| COMPLEMENT | +180 | +0° (punchier / lighter base — see note) |
| SPLIT-COMP | +150 | +210 |
| TRIAD | +120 | +240 |
| ANALOGOUS | −30 | +30 |
| TIGHT ANALOG | −15 | +15 |
| TETRAD | +90 | +180 |
| MONOCHROME | same hue, stepped V/S | |

Complement’s “slot 3 = punchier primary” is easy to get wrong. **v1 default:**
slot 3 = +0° and leave V/S to the operator; with only two columns, slot 2 = +180.
Document the chosen rule in `color-harmony.js` and a test.

### 5.4 Save contract

Unchanged per bound column:

- Color → `"255, 0, 80"`
- Rainbow → `"RAINBOW"`
- Cleared → `""`

`sheet-format.js` / `src/sheets` comments about leading-zero / thousands-separator
corruption stay authoritative. Palette code emits hex / `RAINBOW` / empty into the
existing widgets (or an equivalent `applyPaletteToValues` helper that
`collectEditorChanges` can read). Never a custom PATCH body.

Edit-session collection must include **every** `columns[]` header even though the
view field itself has no `field.column`. `buildViewEditorColumns` should mark
those headers as `{ type: "color" }` from the palette field.

---

## 6. Implementation slices

### M16a — Harmony math + field-map contract (no overlay chrome)

- Add `public/shared/color-harmony.js`:
  - preset table, `offsetHue`, `rebuildHarmony({ force })`, `setPrimaryHue`,
    `setSlotHue` (unlink), link flags, HSL apply.
  - Pure functions; HSV via existing `color-parse.js`.
- Config: accept `type: "palette"` + `columns` (length 2–3); reject `column`;
  reject duplicate headers across palette + color fields on the same view.
- `field-display.js`: `groupFieldsForLayout` / `resolveFieldsLayoutMode` treat
  palette as its own row type. Tests in `test/field-display.test.js`.
- `buildViewEditorColumns`: palette `columns` become color editor columns.
- `test/color-harmony.test.js`:
  - triad / complement / analogous offsets from a known primary
  - drag-primary keeps linked deltas; unlinked slot stays put
  - force-rebuild re-links
  - `formatCellForSheet` still emits `"R, G, B"` (integration assert)
- **Accept:** `npm test` green. No overlay CSS. Example config may document the
  shape in a comment or example only if tests need a fixture — do not cut over
  Lighting yet.

### M16b — Module + overlay (HSL, bar layout)

- Read-mode palette module in `view-render.js` (60/30/10 + slot chips).
- `palette-editor.js`: overlay lifecycle mirrored on `color-picker.js`
  (`openPaletteEditor`, `closePaletteEditor`, Escape/backdrop cancel, focus restore).
- `ws-client.js` already closes the single picker on navigation — also close palette.
- Edit: tapping the module starts `startEdit` then `openPaletteEditor` after mount
  (mirror `openOperatorColorField`).
- Done writes each slot; Cancel restores snapshot.
- CSS for short/wide; thumbs; 60/30/10; preset chips.
- `config.example.json`: Lighting field list uses one palette entry (OD-P19).
  Visuals may keep three color fields for side-by-side comparison.
- Tests: layout grouping, config validation, structural overlay export, Done
  mapping helper if jsdom-less collect tests cannot drive the dialog.
- **Accept:**
  - Dropping `{ type: "palette", columns: ["RGB_1","RGB_2","RGB_3"] }` on a view
    shows one module; no extra color cards for those columns
  - 2560×720 (or equivalent): overlay usable without scrolling the page under it
  - Edit palette → change two slots → Cancel → widgets unchanged
  - Edit palette → triad → Done → Save → sheet cells are spaced RGB
  - A remaining `type: "color"` field on another column still uses the old picker
  - Rainbow slot skipped by presets; still saves `RAINBOW`
  - Config with palette + color on `RGB_1` fails validation

### M16c — Engines + Rainbow-as-flag (optional)

- OKLCH rotate + chroma binary-search gamut map (Selecta’s critical correctness note).
- RYB piecewise warp + inverse.
- Engine toggles in the overlay header only if they fit the short chrome;
  otherwise a single overflow menu.
- Rainbow preserves underlying HSV when toggled off.
- Port Selecta `?selftest` assertions into `test/color-harmony.test.js`.
- **Accept:** saturated red complement is cyan (HSL) vs green (RYB); out-of-gamut
  rotations stay in 0–255; `npm test` green.

### M16d — Wheel skin + Visuals cutover (optional, after real-bar time)

- Square or elliptical HSV disc **only if** M16b has been used on the show box
  and thumbs-on-a-strip feels insufficient.
- Cache disc `ImageData`; handles on a second canvas (Selecta). Never redraw the
  disc during drag.
- Must degrade: if `dvh` is too short, keep the strip and hide the disc.
- Swap Visuals’ three color fields for one palette field in `config.example.json`
  when the module is the default look (local `config.json` is the operator’s call).
- **Do not start M16d in the same session as M16b.**

---

## 7. Verification checklist

1. `npm test` — include NFR-1 only if ingest was touched (it should not be).
2. `npm run sim` — Lighting with a palette field; Visuals with color fields (or
   both palettes after cutover).
3. Short viewport: 2560×720 and a phone-width portrait check (must not become
   three stacked full pickers).
4. Round-trip: Done + Save a value with a **leading zero channel** (`0, 120, 216`)
   and confirm the sheet / rematch still shows cyan, not `120216`.
5. Cancel after dragging primary with 2+3 linked — form matches pre-open values.
6. Clip change while overlay is open — existing edit-session freeze still applies;
   closing cancel/done does not write the wrong row.
7. Single `type: "color"` field elsewhere still Clear / Rainbow / single picker.
8. A view with only `{ type: "palette", columns: ["RGB_1","RGB_2"] }` (two slots)
   renders and saves two columns; no third thumb.
9. Invalid config (palette missing `columns`, or `RGB_1` listed as both palette
   and color) fails at boot with a clear path.

---

## 8. Explicitly out of scope

- Selecta Dropbox library, conflicted-copy healing, always-on-top.
- Admin field-map editor (still M7 note).
- M12 multi-operator locks on `RGB_*` (orthogonal; don’t block on it).
- Auto-harmony inference from existing triplets.
- Deleting `type: "color"` from the type system.

---

## 9. Reporting / agent prompts

When implementing, start with:

> Implement M16a per `docs/plans/M16-palette-editor.md` §6 (M16a): extract HSL
> harmony math into `public/shared/color-harmony.js`, and accept `type: "palette"`
> in the view field map + layout grouping. Do not add overlay UI. Do not replace
> `color-picker.js`. Do not change sheet formatters. Do not cut over Lighting
> in `config.example.json` yet.

Then M16b, then stop for a real-bar look before M16c/d.

Do **not** report M16b done without exercising a ~720px-tall viewport and without
proving a view can show a palette module from config alone.

---

## 10. ROADMAP

M16 is listed as planned in [`ROADMAP.md`](../../ROADMAP.md). Do not mark the
feature done until M16b acceptance is met on a short display.
