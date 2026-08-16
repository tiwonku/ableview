# AbleView

A behind-the-scenes "now playing" board for a live show. AbleView watches the master
Ableton session (read-only, over OSC), matches the currently-playing clip against a shared
Google Sheet of cue notes, and pushes each operator — band, visuals, lighting — a live
web view of exactly the info they need.

Full build specification: [`ableview_spec_from_claude.md`](./ableview_spec_from_claude.md).
Milestone status and future work: [`ROADMAP.md`](./ROADMAP.md).

## Quick start

Requires **Node.js ≥ 20 (LTS)**. Verify before `npm install`:

```bash
node -v   # must print v20.x or higher (v22.x is fine)
npm -v    # bundled with Node; should print a version
```

If Node is missing or too old:

| OS | Install |
|---|---|
| **Windows** | [nodejs.org LTS](https://nodejs.org/) installer, or `winget install OpenJS.NodeJS.LTS` |
| **macOS** | [nodejs.org LTS](https://nodejs.org/) pkg, or `brew install node@20` |
| **Linux / Raspberry Pi** | [NodeSource setup](https://github.com/nodesource/distributions) for your distro, or `nvm install 20` |

Re-open your terminal after installing, then run `node -v` again.

```bash
npm install
cp .env.example .env                              # sheet ID, service account key path, HTTP port
cp config/config.example.json config/config.json  # local settings (gitignored)

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

## Getting Ableton ready

AbleView reads clip names from a live Ableton session via [AbletonOSC](https://github.com/ideoforms/AbletonOSC). It never sends write commands — only listen/register and read addresses (see NFR-1 below).

1. **Install AbletonOSC** on the Ableton machine — add it as a **Control Surface / MIDI Remote Script** in Live's preferences (follow the AbletonOSC README for your Live version).
2. **Open the show set** and confirm a dedicated **cue track** exists (default name `"Cue"` in config) with **named session clips** that match your Google Sheet's match column.
3. **Network** — the AbleView box must reach the Ableton machine on UDP. AbletonOSC listens on port **11000** and sends replies to the requesting host on **11001** (unicast, not multicast). This is **not** Ableton Link traffic; a dedicated **Link VLAN** for Ableton machines is fine even when operator laptops sit on another VLAN — the show box needs a route (often dual-homed) to the master and operators need TCP to the show box on `HTTP_PORT`. See [`deploy/RUNBOOK.md`](./deploy/RUNBOOK.md#ableton-link-vlan-vs-operator-vlan).
4. **Point AbleView at Ableton** — set `ingest.abletonHost` in `config/config.json` (or from `/views/admin`) to the Ableton machine's reachable IP (Link VLAN IP when VLANs are split). Ports default to 11000/11001.
5. **Disable simulation** — ensure `sim.enabled` is `false` for a live session (`npm start`, not `npm run sim`).
6. **Smoke test** — launch a clip on the cue track; the admin view should show the clip name and a sheet match within a second or two.

If you are iterating without Ableton, use `npm run sim` instead — no OSC setup required.

## Configuration

Two layers (spec §8):

- `.env` — secrets and machine-specific values (sheet ID, service-account key path, HTTP port). Never committed.
- `config/config.json` — everything else: OSC ports, watched tracks, authoritative cue track, simulator settings, match threshold, per-view field maps. Copy from `config/config.example.json` on first setup; never committed.

**Show-day settings** (Ableton IP, cue track, sheet tab/columns, match threshold, **simulation on/off**) can also be changed from the **admin view** at `/views/admin` without SSH. Changes save to `config.json` and apply immediately. Secrets (`SHEET_ID`, service account key, `HTTP_PORT`) remain in `.env`.

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
| Windows (headless NUC) | NSSM (recommended) or Task Scheduler | [`deploy/install-windows.ps1`](./deploy/install-windows.ps1) |
| macOS (MacBook backup) | launchd LaunchAgent | [`deploy/install-macos.sh`](./deploy/install-macos.sh) |

#### Making a show box production-ready

Use the same codebase; follow the path for your OS. Full step-by-step instructions live in
[`deploy/README.md`](./deploy/README.md). Summary:

1. **Copy the repo** to a fixed path (`/opt/ableview` or `C:\AbleView`).
2. **Configure** `.env` (sheet ID, service-account key, port) and copy
   `config/config.example.json` to `config/config.json` (Ableton host, cue track, views).
   Set `sim.enabled` to `false`.
3. **Smoke-test manually** before installing any service:
   ```bash
   npm run start:production
   curl http://localhost:8080/health
   ```
   Production mode turns on stricter boot checks — sheet credentials and admin view
   required when not simulating. Leave `NODE_ENV` unset on dev machines.
4. **Install the OS service** and enable start on boot:
   - **Linux / Pi:** copy `deploy/ableview.service` to systemd, `enable --now`.
   - **Windows NUC:** run `deploy/install-windows.ps1` (elevated) — see [`deploy/README.md`](./deploy/README.md).
   - **macOS:** run `deploy/install-macos.sh` — see [`deploy/README.md`](./deploy/README.md).
5. **Logs:** default is stdout (journald on Linux, NSSM capture on Windows, launchd log file on macOS). Optionally set
   `LOG_FILE=./logs/ableview.log` and install `deploy/logrotate.example` on Linux.
6. **Verify after power-cycle:** `curl http://<box-ip>:8080/health` returns `200` with
   `"status":"ok"` once sheets have synced and a clip has played (brief `503`/`degraded` at
   cold start is normal). Use [`deploy/RUNBOOK.md`](./deploy/RUNBOOK.md) for show-night checklists
   (including **Link VLAN vs operator VLAN** networking).

#### Operator touch NUC (desktop shortcut)

On a Windows operator panel, create a desktop shortcut whose **Target** is:

```
"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --user-data-dir="%LOCALAPPDATA%\AbleViewKiosk" --start-maximized --app="http://<SHOW_BOX_IP>:8080/views/band?kiosk=1" --no-first-run --no-default-browser-check --disable-features=Translate
```

Replace `<SHOW_BOX_IP>` with the show box IP on the operator VLAN, and `/views/band` with `/views/visuals` or `/views/lighting` as needed. Copy the shortcut into the Startup folder (`shell:startup`) for auto-launch.

`--user-data-dir` is required so this is its own Edge profile. Without it, an already-running Edge often swallows `--app=` as a normal window, and hold-to-**Exit** cannot close it. Close every everyday Edge window once, then launch from this shortcut. `deploy/ableview-kiosk.cmd` wraps the same flags if you prefer a `.cmd` shortcut.

`?kiosk=1` shows **Fullscreen**, **Reload**, and hold-to-**Exit**. Tap Fullscreen after launch to hide the Windows title bar. Do not use Edge `--kiosk` — it blocks Exit.

Full kiosk notes: [`deploy/RUNBOOK.md`](./deploy/RUNBOOK.md#touch-display-manual-kiosk).

Do **not** enable systemd, NSSM, or Task Scheduler on your day-to-day development machine
unless you explicitly want that behavior.

### What differs per host (not per codebase)

- **Service install** — manual `npm start` on dev; systemd / NSSM / launchd on the show box only
- **Config** — OSC host/ports, sheet ID, view URLs depend on where Ableton and operators sit on the LAN
- **Logs** — stdout in dev; journald / NSSM / optional `LOG_FILE` on the show box
- **Production validation** — `NODE_ENV=production` on the show box only; unset during local iteration

See also spec §4 NFR-2 (stability / auto-start) and §10 M6 in
[`ableview_spec_from_claude.md`](./ableview_spec_from_claude.md).

