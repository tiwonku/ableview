# AbleView production deployment

AbleView ships one codebase for every host. **Boot auto-start and crash restart are not
enabled by the application** — you opt in by installing a service on the show box only.

The checklist below assumes M6 is complete: `/health`, production config validation
(`NODE_ENV=production`), optional file logging, and reconnect behavior are in the app.

**Show-night cheat sheet:** [`RUNBOOK.md`](./RUNBOOK.md)

---

## Quick install (recommended)

After the [production checklist](#production-checklist-all-platforms) (Node, `.env`,
`config/config.json`, secrets on disk):

### Windows (NSSM)

Run **elevated** PowerShell from the install directory:

```powershell
cd C:\AbleView
.\deploy\install-windows.ps1
```

Requires [NSSM](https://nssm.cc/download) on PATH. The script runs preflight checks, an
optional `/health` smoke test, registers the service to run `deploy/run-production.mjs`,
and prints operator URLs.

Remove: `.\deploy\uninstall-windows.ps1`

### macOS (LaunchAgent)

Run in Terminal from the install directory (no sudo):

```bash
cd ~/AbleView
chmod +x deploy/install-macos.sh deploy/uninstall-macos.sh
./deploy/install-macos.sh
```

Default install dir: `~/AbleView` (override with `--install-dir`). Starts when you log in,
restarts on crash. Good for MacBook backup Ableton on the same user session.

Remove: `./deploy/uninstall-macos.sh`

### Linux / Raspberry Pi (systemd)

Copy and edit the unit, then enable:

```bash
sudo cp deploy/ableview.service /etc/systemd/system/ableview.service
# Edit paths if not using /opt/ableview
sudo systemctl daemon-reload
sudo systemctl enable --now ableview
```

The unit runs `deploy/run-production.mjs` (sets production mode and repo-root cwd).

### Smoke test before installing any service

```bash
npm run start:production
# another terminal:
curl http://localhost:8080/health
```

Stop with Ctrl+C, then run the install script for your OS.

---

## Production checklist (all platforms)

1. **Install Node.js ≥ 20** on the show box.
2. **Copy the repo** to a fixed path (examples below use `/opt/ableview`, `~/AbleView`, or `C:\AbleView`).
3. **Install dependencies:** `npm install --omit=dev` (there are no devDependencies today; safe either way).
4. **Configure secrets** — copy `.env.example` to `.env` and set:
   - `GOOGLE_SERVICE_ACCOUNT_KEY_PATH`
   - `SHEET_ID`
   - `HTTP_PORT` (default `8080`)
5. **Place the service account key** at the path in `.env` (e.g. `secrets/service-account.json`).
6. **Share the Google Sheet** with the service account email (`client_email` in the JSON) as **Editor** (required for admin row edits; Viewer is read-only).
7. **Copy and tune local config:**
   ```bash
   cp config/config.example.json config/config.json
   ```
   Set `ingest.abletonHost`, cue track, sheet columns, and views for this network.
8. **Production mode** — `deploy/run-production.mjs` sets `NODE_ENV=production` automatically when used as the service entrypoint. Enables stricter boot validation (sheet credentials, admin view required when not simulating).
9. **Confirm `sim.enabled` is `false`** in `config/config.json` for show night.
10. **Verify manually once** before installing the service:
    ```bash
    npm run start:production
    curl http://localhost:8080/health
    ```
11. **Install the OS service** (Quick install above) and enable start on boot.
12. **Open operator URLs** on the LAN, e.g. `http://<show-box-ip>:8080/views/band`. Fill in [`RUNBOOK.md`](./RUNBOOK.md).

Nothing in steps 11–12 runs automatically on a development machine unless you explicitly
install and enable a service there.

---

## Network: Link VLAN and operator VLAN

Ableton machines are often on a **dedicated Ableton Link VLAN**; operator browsers are often
**not** on that VLAN. AbleView does not use Link — only **unicast OSC** (11000/11001) and
**HTTP/WebSocket** (default 8080). That design works across VLANs if the **show box** can reach
the master Ableton IP and operators can reach the show box on TCP 8080, and the show box can
reach Google (443) for sheet sync.

During install:

- Set `ingest.abletonHost` to the master’s IP on the network path the show box uses (usually
  the Link VLAN address).
- Give operators URLs using the show box IP on the **operator VLAN** (what `install-windows.ps1`
  prints may be the primary interface — verify against your routing plan).
- **Dual-homed show box (recommended when VLANs are isolated):** Link VLAN NIC = static IP, no
  default gateway; operator/internet NIC = default gateway. Only one default gateway.
- Open host firewall: inbound **TCP 8080**, **UDP 11001** (and ensure outbound UDP 11000 to
  Ableton is allowed).
- Confirm AbletonOSC accepts remote OSC (not bound to localhost only).

Show-night checklists, fill-in fields, and failure steps:
[`RUNBOOK.md`](./RUNBOOK.md#ableton-link-vlan-vs-operator-vlan).

---

## Linux / Raspberry Pi (systemd)

**Paths:** `/opt/ableview` (adjust if you use another directory).

### 1. Prepare the install

```bash
sudo mkdir -p /opt/ableview
sudo chown "$USER:$USER" /opt/ableview
git clone <repo-url> /opt/ableview   # or rsync/scp your tree
cd /opt/ableview
npm install
cp .env.example .env                 # edit with production values
cp config/config.example.json config/config.json
# edit config/config.json for this show
```

### 2. Install the systemd unit

Edit `deploy/ableview.service` if your install path or Node binary differs (`which node`).

```bash
sudo cp deploy/ableview.service /etc/systemd/system/ableview.service
sudo systemctl daemon-reload
sudo systemctl enable ableview      # start on boot
sudo systemctl start ableview
sudo systemctl status ableview
```

### 3. Logs

**Default (recommended):** stdout/stderr go to **journald** (already configured in the unit).

```bash
journalctl -u ableview -f
```

Journald rotates logs automatically via system settings.

**Optional file logs:** add to `.env`:

```env
LOG_FILE=./logs/ableview.log
```

Then install logrotate:

```bash
sudo cp deploy/logrotate.example /etc/logrotate.d/ableview
```

### 4. Health check

```bash
curl -s http://localhost:8080/health | jq .
```

Use this from monitoring or after a power-cycle. Status `ok` means no degraded checks;
`503` with `degraded` is normal briefly at startup or when the sheet cache is stale.

### 5. Disable / remove

```bash
sudo systemctl disable --now ableview
sudo rm /etc/systemd/system/ableview.service
sudo systemctl daemon-reload
```

---

## Windows headless NUC (NSSM)

**Paths:** `C:\AbleView` (example).

Use [`install-windows.ps1`](./install-windows.ps1) (Quick install above) instead of manual
steps when possible.

### Advanced: manual NSSM registration

#### 1. Prepare the install

- Install [Node.js LTS](https://nodejs.org/) (≥ 20).
- Clone or copy the repo to `C:\AbleView`.
- Run `npm install` in that folder.
- Copy `.env.example` to `.env` and configure.
- Copy `config\config.example.json` to `config\config.json` and tune for this network.

#### 2. Install NSSM

Download [NSSM](https://nssm.cc/download) and place `nssm.exe` on your PATH, or invoke it by full path.

#### 3. Register the service

Run **elevated** PowerShell or CMD:

```powershell
cd C:\AbleView

nssm install AbleView "C:\Program Files\nodejs\node.exe" "deploy\run-production.mjs"
nssm set AbleView AppDirectory C:\AbleView
nssm set AbleView AppEnvironmentExtra NODE_ENV=production
nssm set AbleView AppStdout C:\AbleView\logs\stdout.log
nssm set AbleView AppStderr C:\AbleView\logs\stderr.log
nssm set AbleView AppRotateFiles 1
nssm set AbleView AppRotateOnline 1
nssm set AbleView AppRotateBytes 10485760
nssm set AbleView AppExit Default Restart
nssm set AbleView AppRestartDelay 3000
nssm set AbleView Start SERVICE_AUTO_START

mkdir C:\AbleView\logs -Force
nssm start AbleView
```

Adjust the Node.exe path if installed elsewhere (`where.exe node`).

**`.env` and secrets:** AbleView loads `.env` from the install directory when
`AppDirectory` is set correctly (see `loadConfig()` in `src/config/index.js`). You do
**not** need to duplicate `SHEET_ID` or key paths in NSSM unless `AppDirectory` is wrong.
`deploy/run-production.mjs` also forces production mode and repo-root cwd.

**Optional app-level log file** (in addition to NSSM stdout capture):

```env
LOG_FILE=./logs/ableview.log
```

Periodically archive or truncate `logs\` on long runs if not using NSSM rotation alone.

### 4. Health check

```powershell
Invoke-RestMethod http://localhost:8080/health
```

### 5. Disable / remove

```powershell
.\deploy\uninstall-windows.ps1
```

---

## macOS (LaunchAgent)

**Paths:** `~/AbleView` (default for `install-macos.sh`).

Use [`install-macos.sh`](./install-macos.sh) (Quick install above). The LaunchAgent:

- Runs when the show user **logs in** (good for MacBook + Ableton in the same session)
- Uses `deploy/run-production.mjs` as the entrypoint
- Writes logs to `{InstallDir}/logs/launchd.log`

Disable sleep and enable auto-login for show Macs — see [`RUNBOOK.md`](./RUNBOOK.md).

Remove: `./deploy/uninstall-macos.sh`

---

## Windows (Task Scheduler alternative)

If you prefer not to use NSSM:

1. Create a task: **Trigger** = At startup; **Action** = Start program  
   `C:\Program Files\nodejs\node.exe` with argument `deploy\run-production.mjs`, start in `C:\AbleView`.
2. Enable **Restart on failure** in task settings if available.
3. Capture logs via `LOG_FILE` in environment or redirect output in a wrapper `.cmd` script.

Task Scheduler is workable but NSSM or systemd gives simpler crash restart behavior.

---

## Development machines

Do **not** enable systemd, NSSM, LaunchAgent, or Task Scheduler startup tasks on the machine where you
iterate daily. Use:

```bash
npm run sim
npm start
```

Leave `NODE_ENV` unset (or `development`). Production validation and service install are
opt-in only on the dedicated show box.
