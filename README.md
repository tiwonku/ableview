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
| M4 | View server + first view | ✅ done |
| M5 | Remaining views + admin/status | ✅ done |
| M6 | Hardening | ✅ done |

## Quick start

Requires Node.js ≥ 20.

```bash
npm install
cp .env.example .env      # fill in when Sheets integration lands (M2)

# Run in simulation mode (no Ableton needed) — walks config/scenarios/demo-set.json
npm run sim
# Then open http://localhost:8080/views/band (or /views/visuals, /views/lighting, /views/admin)

# Run against a real Ableton session with AbletonOSC installed
npm start

# Tests (includes the NFR-1 read-only OSC assertion)
npm test

# Health check (while the process is running)
curl http://localhost:8080/health
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

## Development vs production

AbleView uses the same application on every host; what changes is how you **run** it. Think in
terms of deployment profiles rather than one global setup.

| Profile | Boot auto-start | Restart on crash | Typical host |
|---|---|---|---|
| **Development** | No | No | Full Windows/Linux machine where you iterate (Ableton + browser on same box) |
| **Rehearsal** | Optional | Optional | Pre-show hardware test — same config as show night, manual start is fine |
| **Show production** | Yes | Yes | Dedicated headless NUC or Pi — plug in, walk away |

### Development (default)

Use this on your day-to-day machine. No service install required.

```bash
npm run sim    # no Ableton — walks the demo scenario
npm start      # real AbletonOSC on the network
npm test
```

Start and stop manually. If the process crashes during development, you *want* it to stay
stopped so you can read the error. Auto-start on boot is not expected here.

### Show production

M6 adds application hardening that runs on every host: `/health`, stronger config validation
when `NODE_ENV=production` is set, optional file logging (`LOG_FILE`), and the reconnect
behavior from earlier milestones (Ableton OSC watchdog, sheet cache, browser WebSocket
reconnect).

**Boot auto-start and crash restart are not enabled by the app.** You opt in on the show box
by installing a service. The acceptance test for production is: **power-cycle the box →
everything comes back with no human intervention** — but only after you complete the
service install below.

| OS | Service manager | Reference |
|---|---|---|
| Linux / Raspberry Pi | systemd | [`deploy/ableview.service`](./deploy/ableview.service) |
| Windows (headless NUC) | NSSM (recommended) or Task Scheduler | [`deploy/README.md`](./deploy/README.md) |

#### Making a show box production-ready

Use the same codebase; follow the path for your OS. Full step-by-step instructions live in
[`deploy/README.md`](./deploy/README.md). Summary:

1. **Copy the repo** to a fixed path (`/opt/ableview` or `C:\AbleView`).
2. **Configure** `.env` (sheet ID, service-account key, port) and `config/config.json`
   (Ableton host, cue track, views). Set `sim.enabled` to `false`.
3. **Smoke-test manually** before installing any service:
   ```bash
   NODE_ENV=production npm start
   curl http://localhost:8080/health
   ```
   `NODE_ENV=production` (or `ABLEVIEW_PRODUCTION=1`) turns on stricter boot checks — sheet
   credentials and admin view required when not simulating. Leave it unset on dev machines.
4. **Install the OS service** and enable start on boot:
   - **Linux / Pi:** copy `deploy/ableview.service` to systemd, `enable --now`.
   - **Windows NUC:** register with NSSM (rotation + restart) — commands in `deploy/README.md`.
5. **Logs:** default is stdout (journald on Linux, NSSM capture on Windows). Optionally set
   `LOG_FILE=./logs/ableview.log` and install `deploy/logrotate.example` on Linux.
6. **Verify after power-cycle:** `curl http://<box-ip>:8080/health` returns `200` with
   `"status":"ok"` once sheets have synced and a clip has played (brief `503`/`degraded` at
   cold start is normal).

Do **not** enable systemd, NSSM, or Task Scheduler on your day-to-day development machine
unless you explicitly want that behavior.

### What differs per host (not per codebase)

- **Service install** — manual `npm start` on dev; systemd/NSSM on the show box only
- **Config** — OSC host/ports, sheet ID, view URLs depend on where Ableton and operators sit on the LAN
- **Logs** — stdout in dev; journald / NSSM / optional `LOG_FILE` on the show box
- **Production validation** — `NODE_ENV=production` on the show box only; unset during local iteration

See also spec §4 NFR-2 (stability / auto-start) and §10 M6 in
[`ableview_spec_from_claude.md`](./ableview_spec_from_claude.md).

