# Companion — AbleView moments page

Optional importable Stream Deck layout for crew **DOPE** moment markers.

## Status

There is **not yet** a committed `.companionconfig` in this repo — Companion export files are
version-specific and must be validated on your Companion build before sharing.

**For now:** follow the step-by-step recipe in [`docs/companion-moments.md`](../docs/companion-moments.md)
(§2 simple button, §3 green/yellow/red feedback, §2 option B for easy `who` via custom variable).

**Once validated on your rig:**

1. Configure one feedback-aware DOPE button using the doc.
2. Companion → **Buttons** → **Export page** → save here as `ableview-moments.companionconfig`.
3. Other decks import via **Import / Export → Buttons → insert page** and remap the AbleView HTTP
   connection.

## What the export should contain

- Four preset buttons (`keys`, `bass`, `drums`, `vocals`) **or** one button using `$(custom:av_who)`
- Generic HTTP **POST** `/api/moments` with JSON body
- Custom variable **`av_moment_feedback`** wired for green / yellow / red backgrounds (see doc §3)
- Optional **GET** `/api/moments` step to parse `feedbackState` from the response

## Per-person `who` (pick one)

| Approach | When to use |
|---|---|
| Hardcode `"who"` in each button's JSON body | Fixed roles — simplest |
| `{"kind":"dope","who":"$(custom:av_who)"}` | One shared button; set `av_who` once per deck |

## Admin confirmation

The AbleView **Settings → Session log** panel shows **Moments this session: N** and updates live
when crew tap buttons (no page refresh needed).
