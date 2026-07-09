# AbleView roadmap

Build specification: [`ableview_spec_from_claude.md`](./ableview_spec_from_claude.md).

## Milestone status

| Milestone | Description | Status |
|---|---|---|
| M1 | Skeleton + ingest + simulator | ✅ done |
| M2 | Sheets sync + offline cache | ✅ done |
| M3 | Fuzzy matcher | ✅ done |
| M4 | View server + first view | ✅ done |
| M5 | Remaining views + admin/status | ✅ done |
| M6 | Hardening | ✅ done |
| M7 | Admin settings GUI | ✅ done |
| M8 | Sheet row editor | ✅ done |

v2026 core scope (spec §10, §13) is complete. Items below are deferred, partial, or
post-v2026.

---

## Post-v2026 additions

| Feature | Description | Status |
|---|---|---|
| **Launch anticipation** | Ingest listens to `fired_slot_index` on the cue track; authoritative clip switches on scene fire before the quantization downbeat. OSC sim models the gap via `sim.quantDelaySeconds`. | ✅ done |
| **Sheet row editor** | Edit matched cue rows from admin; typed widgets for BPM, Cue/Pillar icons, RGB colors; `PATCH /api/sheets/rows/:rowId`; edit session locks row while clip changes. Service account needs Editor + `spreadsheets` scope. | ✅ done |
| **View-scoped row editor** | Operator views edit their configured fields by default; set `editable: false` to hide the button. Same widgets and edit-session locking as admin. | ✅ done |
| **Sheet row append** | Add cue rows from admin on no-match; pre-fills match column from playing clip; `POST /api/sheets/rows`; appends to Google Sheet, updates cache, rematches. | ✅ done |

---

## Partially implemented (spec gaps)

These are mentioned in the spec but not fully built. The app works without them using the
default `track` strategy and the other sim drivers.

| Item | Spec ref | Current state |
|---|---|---|
| **`scene` / `mostRecent` cue strategies** | §6 | Config-valid, but only `track` is fully implemented. Other strategies fall back to “any playing watched clip.” |
| **Manual sim driver from admin** | §7 | Admin sim panel (internal mode): fire/clear, pause/resume, prev/next, clip picker from scenario or sheet. OSC sim mode still has no manual controls. |
| **View field maps in admin** | M7 scope note | Still edited in local `config/config.json` (or SSH). Admin covers ingest, sim, sheets, and match — not per-view layouts. |
| **`.env` secrets in admin** | M7 scope note | `SHEET_ID`, service account key path, and `HTTP_PORT` remain in `.env` only. |

---

## Future work (explicitly out of scope for v2026)

From spec §11 — design leaves extension points; no code ships for these yet:

- **OSC rebroadcast** — emit clip/cue triggers to lighting consoles (GrandMA3, etc.) from the
  internal event bus.
- **Waveform + playhead** — audio waveform with playhead for the playing clip (would need
  `playing_position` from AbletonOSC and a new view panel).
- **Write-back to Ableton** — will not be built; NFR-1 is permanent.

---

## Future ingest hardening (post-v2026)

From spec §6:

- **Send-only Max for Live device** — observe playing clips and **broadcast/multicast** OSC
  one-way (no inbound write surface, IP-independent fan-out). Would plug into the same ingest
  interface as AbletonOSC; swapping sources should not require an app rewrite.

---

## Open decisions

From spec §12 — confirm with the maintainer before hardcoding show-specific assumptions:

| ID | Topic | Status |
|---|---|---|
| OD-1 | Authoritative cue source | **Resolved** — `track` strategy on a designated cue track (`ingest.authoritative.track`). |
| OD-2 | Implementation language | Node.js in use; Python + FastAPI remains a valid alternative with the same architecture. |
| OD-3 | View names + sheet columns | Example field maps in `config/config.example.json`; confirm real operator views and columns per show. |
| OD-4 | Match column + aliases | Confirm which sheet column clip names match against and whether aliases are maintained. |
| OD-5 | Hardware / OS | Linux/Pi + systemd and Windows NUC + NSSM both supported; pick per deployment. |
