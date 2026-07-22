# AbleView show-night runbook

Print this page and fill in the blanks during install. The install scripts print detected
URLs — copy them here.

**Power-cycle test passed:** _______________ (date)  
**Show box hostname / location:** _______________  
**Show box LAN IP:** _______________

---

## Operator URLs

Replace `__SHOW_BOX_IP__` with the show box IP (or `localhost` if the browser runs on the same machine).

| Role | URL |
|---|---|
| Band | `http://__SHOW_BOX_IP__:8080/views/band` |
| Visuals | `http://__SHOW_BOX_IP__:8080/views/visuals` |
| Lighting | `http://__SHOW_BOX_IP__:8080/views/lighting` |
| Admin | `http://__SHOW_BOX_IP__:8080/views/admin` |
| Health (JSON) | `http://__SHOW_BOX_IP__:8080/health` |

**Backup MacBook IP (if used):** _______________

---

## Pre-show checklist

### T-24 hours

- [ ] Show box on **wired Ethernet** (Wi‑Fi is backup only)
- [ ] **Sleep disabled** — Windows: Never sleep; Mac: Prevent sleep when display is off; lid open or `caffeinate` on MacBook
- [ ] Windows Update / macOS auto-reboot deferred during show window
- [ ] `sim.enabled` is **false** — admin view must **not** show SIMULATION MODE banner
- [ ] `.env` secrets present; service account key file on disk
- [ ] Google Sheet shared with service account (Editor for row edits)
- [ ] AbletonOSC loaded on master (and backup MacBook if applicable)
- [ ] `ingest.abletonHost` correct — LAN IP for remote Ableton, `127.0.0.1` if Ableton on same Mac

### T-1 hour

- [ ] Reboot show box once — AbleView starts **without** opening a terminal
- [ ] `curl http://__SHOW_BOX_IP__:8080/health` — eventually `"status":"ok"` (brief `degraded` at cold start is OK)
- [ ] Admin → sheet cache **Fresh** (not stale)
- [ ] Fire a cue clip in Ableton → all operator views update within ~1 second
- [ ] Touch display browser open to the correct view URL (see kiosk notes below)
- [ ] Backup MacBook powered, logged in, service running (if failover planned)

---

## Status bar legend (what operators see)

| Indicator | Meaning | Action |
|---|---|---|
| **Disconnected** | WebSocket down or server restarting | Wait ~5 seconds. If it persists, check the service (playbooks below). |
| **Stale cache** | Google unreachable; last sheet snapshot still served | Show continues. Stage manager syncs sheet from admin when network returns. |
| **No confident match** | Clip name did not match the sheet above threshold | Expected safety state. Fix row/alias in sheet or add row from admin. |
| **SIMULATION MODE banner** | Simulator is on | **Stop show** — disable sim in admin or set `sim.enabled: false` in config. |

Views also show **last update** time. If that timestamp stops advancing when clips change, the chain from Ableton → AbleView is broken.

---

## Failure playbooks

### AbleView service down

**Windows (elevated PowerShell):**

```powershell
nssm restart AbleView
# or
nssm start AbleView
```

Logs: `C:\AbleView\logs\stdout.log` and `stderr.log` (adjust if install path differs).

**macOS (Terminal):**

```bash
launchctl kickstart -k gui/$(id -u)/com.ableview.server
# status:
launchctl print gui/$(id -u)/com.ableview.server
```

Logs: `~/AbleView/logs/launchd.log` (adjust install dir if different).

**Linux:**

```bash
sudo systemctl restart ableview
journalctl -u ableview -n 50
```

### Ableton restarted

Wait ~30 seconds. AbleView re-registers OSC listeners automatically. No restart required unless clips still do not update after 60 seconds.

### Failover to backup MacBook

1. Confirm backup Ableton set is open and AbletonOSC is active.
2. Point operator browsers to backup IP URLs (table above).
3. Confirm `ingest.abletonHost` is `127.0.0.1` on the MacBook if Ableton runs locally.
4. Fire a test clip — views should update.

### Wrong or missing cue

- **No match shown** — add/fix sheet row or alias; use admin **Sync sheet** if needed.
- **Wrong row shown** — should not happen below match threshold; check sheet match column and aliases immediately.

---

## Log locations

| OS | Where |
|---|---|
| Windows (NSSM) | `{InstallDir}\logs\stdout.log`, `stderr.log` |
| macOS (launchd) | `{InstallDir}/logs/launchd.log` |
| Optional app log | `LOG_FILE` in `.env` → `./logs/ableview.log` |
| Linux (systemd) | `journalctl -u ableview -f` |

---

## Touch display (manual kiosk)

No automated kiosk script in v1. On the NUC connected to the operator panel:

1. Create a **show user** with auto-login (optional but recommended).
2. Add browser startup: Edge or Chrome in **kiosk / app mode** to one operator URL, e.g.  
   `msedge --kiosk http://__SHOW_BOX_IP__:8080/views/band`
3. Disable screen sleep and Windows Update forced reboot during show hours.
4. If the browser crashes, restart it — AbleView keeps running as a separate service.

---

## Power-cycle acceptance test

Do this after every service install or hardware change:

1. Note current clip / health status.
2. **Full reboot** the show box (not just sleep).
3. Within 2 minutes, without opening a terminal:
   - `/health` responds
   - Admin loads
4. Fire a cue clip — operator views update.
5. Record pass/fail date at the top of this runbook.

**Pass criteria:** same as M6 — power-cycle → everything recovers with no human intervention (except opening browsers on kiosk machines if not auto-started).

---

## Quick reference

| Task | Command / URL |
|---|---|
| Health check | `http://__SHOW_BOX_IP__:8080/health` |
| Admin settings | `http://__SHOW_BOX_IP__:8080/views/admin` |
| Manual sheet sync | Admin → Sync sheet |
| Install (Windows) | `.\deploy\install-windows.ps1` (elevated) |
| Install (macOS) | `./deploy/install-macos.sh` |
| Full deploy docs | [`deploy/README.md`](./README.md) |
