# AbleView

A behind-the-scenes "now playing" board for a live show. AbleView watches the master
Ableton session (read-only, over OSC), matches the currently-playing clip against a shared
Google Sheet of cue notes, and pushes each operator — band, visuals, lighting — a live
web view of exactly the info they need.

Full build specification: [`ableview_spec_from_claude.md`](./ableview_spec_from_claude.md).

## Status

| Milestone | Description | Status |
|---|---|---|
| M1 | Skeleton + ingest + simulator | ✅ done |
| M2 | Sheets sync + offline cache | ✅ done |
| M3 | Fuzzy matcher | ✅ done |
| M4 | View server + first view | — |
| M5 | Remaining views + admin/status | — |
| M6 | Hardening | — |

## Quick start

Requires Node.js ≥ 20.

```bash
npm install
cp .env.example .env      # fill in when Sheets integration lands (M2)

# Run in simulation mode (no Ableton needed) — walks config/scenarios/demo-set.json
npm run sim

# Run against a real Ableton session with AbletonOSC installed
npm start

# Tests (includes the NFR-1 read-only OSC assertion)
npm test
```

## Configuration

Two layers (spec §8):

- `.env` — secrets and machine-specific values (sheet ID, service-account key path, HTTP port). Never committed.
- `config/config.json` — everything else: OSC ports, watched tracks, authoritative cue track, simulator settings, match threshold, per-view field maps.

Simulation mode can also be forced without editing config: `npm run sim` (or `node src/index.js --sim`).

- `sim.mode: "internal"` feeds NowPlaying events straight to the event bus.
- `sim.mode: "osc"` runs a mock AbletonOSC on the wire and exercises the real OSC listener path.

## Safety guarantee (NFR-1)

AbleView can never mutate the Ableton set. Every outbound OSC message passes through an
allowlist of read/listen addresses (`src/ingest/osc-addresses.js`); write addresses are not
representable, and `npm test` asserts this structurally.

## Deployment targets

- Linux (Ubuntu Server / Raspberry Pi OS) with systemd: `deploy/ableview.service`.
- Windows (headless NUC): run as a service via NSSM or Task Scheduler (unit-equivalent config lands in M6).
