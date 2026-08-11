# Companion — AbleView moments page

Optional importable Stream Deck layout for crew **DOPE** moment markers.

## Status

There is **not yet** a committed `.companionconfig` in this repo — Companion export files are
version-specific and must be validated on your Companion build before sharing.

**For now:** follow the step-by-step recipe in [`docs/companion-moments.md`](../docs/companion-moments.md)
(§2 button + `who`, §3 yellow/green/red feedback with POST response capture and expression mode).

**Once validated on your rig:**

1. Configure one feedback-aware DOPE button using the doc.
2. Companion → **Buttons** → **Export page** → save here as `ableview-moments.companionconfig`.
3. Other decks import via **Import / Export → Buttons → insert page** and remap the AbleView HTTP
   connection.

## What the export should contain

- Preset buttons with hardcoded `who`, **or** one button using `$(custom:moment_who)`
- **Sequential** press actions: `pending` → POST (store JSON in `moment_response`) → expression
  sets `moment_feedback` → optional 1 s wait → clear `moment_feedback`
- **Feedbacks** keyed off `moment_feedback` (`success` / `pending` / `error`)

## Per-person `who` (pick one)

| Approach | When to use |
|---|---|
| Hardcode `"who"` in each button's JSON body | Fixed roles — simplest |
| `{"kind":"dope","who":"$(custom:moment_who)"}` | One shared button; set `moment_who` once per deck |

## Admin confirmation

The AbleView **Settings → Session log** panel shows **Moments this session: N** and updates live
when crew tap buttons (no page refresh needed).
