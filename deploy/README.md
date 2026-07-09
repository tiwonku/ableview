# AbleView production deployment

AbleView ships one codebase for every host. **Boot auto-start and crash restart are not
enabled by the application** — you opt in by installing a service on the show box only.

The checklist below assumes M6 is complete: `/health`, production config validation
(`NODE_ENV=production`), optional file logging, and reconnect behavior are in the app.

---

## Production checklist (all platforms)

1. **Install Node.js ≥ 20** on the show box.
2. **Copy the repo** to a fixed path (examples below use `/opt/ableview` or `C:\AbleView`).
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
8. **Set production mode** in the service environment (not in `.env` unless you prefer):
   - `NODE_ENV=production` **or** `ABLEVIEW_PRODUCTION=1`
   - Enables stricter boot validation (sheet credentials, admin view required when not simulating).
9. **Confirm `sim.enabled` is `false`** in `config/config.json` for show night.
10. **Verify manually once** before installing the service:
   ```bash
   NODE_ENV=production npm start
   curl http://localhost:8080/health
   ```
11. **Install the OS service** (Linux or Windows section below) and enable start on boot.
12. **Open operator URLs** on the LAN, e.g. `http://<show-box-ip>:8080/views/band`.

Nothing in steps 11–12 runs automatically on a development machine unless you explicitly
install and enable a service there.

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

### 1. Prepare the install

- Install [Node.js LTS](https://nodejs.org/) (≥ 20).
- Clone or copy the repo to `C:\AbleView`.
- Run `npm install` in that folder.
- Copy `.env.example` to `.env` and configure.
- Copy `config\config.example.json` to `config\config.json` and tune for this network.

### 2. Install NSSM

Download [NSSM](https://nssm.cc/download) and place `nssm.exe` on your PATH, or invoke it by full path.

### 3. Register the service

Run **elevated** PowerShell or CMD:

```powershell
cd C:\AbleView

nssm install AbleView "C:\Program Files\nodejs\node.exe" "src\index.js"
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

**Environment variables from `.env`:** NSSM does not load `.env` automatically. Either:

- Add each variable via `nssm set AbleView AppEnvironmentExtra KEY=value` (one per line in the NSSM GUI, or repeated `AppEnvironmentExtra` keys — prefer the GUI for many vars), **or**
- Use a small wrapper script that loads `.env` and execs node (not shipped; keep it local if needed).

Most teams set `GOOGLE_SERVICE_ACCOUNT_KEY_PATH`, `SHEET_ID`, and `HTTP_PORT` in NSSM
`AppEnvironmentExtra` for the show box.

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
nssm stop AbleView
nssm remove AbleView confirm
```

---

## Windows (Task Scheduler alternative)

If you prefer not to use NSSM:

1. Create a task: **Trigger** = At startup; **Action** = Start program  
   `C:\Program Files\nodejs\node.exe` with argument `src\index.js`, start in `C:\AbleView`.
2. Set **Environment** for the task (Task Scheduler → task properties → Environment) or use
   a `.env` loader wrapper.
3. Enable **Restart on failure** in task settings if available.
4. Capture logs via `LOG_FILE` in environment or redirect output in a wrapper `.cmd` script.

Task Scheduler is workable but NSSM or systemd gives simpler crash restart behavior.

---

## Development machines

Do **not** enable systemd, NSSM, or Task Scheduler startup tasks on the machine where you
iterate daily. Use:

```bash
npm run sim
npm start
```

Leave `NODE_ENV` unset (or `development`). Production validation and service install are
opt-in only on the dedicated show box.
