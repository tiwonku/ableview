# AbleView show-night runbook

Print this page and fill in the blanks during install. The install scripts print detected
URLs — copy them here.

**Power-cycle test passed:** _______________ (date)  
**Show box hostname / location:** _______________  
**Show box LAN IP (operator VLAN):** _______________  
**Show box Link VLAN IP (if dual-homed):** _______________  
**Ableton master IP (Link VLAN):** _______________

---

## Operator URLs

Replace `__SHOW_BOX_IP__` with the show box IP **on the VLAN where operator browsers live** (or `localhost` if the browser runs on the same machine). Do not use a Link-VLAN-only address unless every operator device can route there.

| Role | URL |
|---|---|
| Band | `http://__SHOW_BOX_IP__:8080/views/band` |
| Visuals | `http://__SHOW_BOX_IP__:8080/views/visuals` |
| Lighting | `http://__SHOW_BOX_IP__:8080/views/lighting` |
| Admin | `http://__SHOW_BOX_IP__:8080/views/admin` |
| Health (JSON) | `http://__SHOW_BOX_IP__:8080/health` |
| Touch NUC (kiosk chrome) | same view URL + `?kiosk=1` — see [Touch display](#touch-display-operator-mini-pc) |

**Backup MacBook IP (if used):** _______________

---

## Ableton Link VLAN vs operator VLAN

Many tours put **Ableton machines on a dedicated Link VLAN** (Layer-2 for Ableton Link discovery). **Operator laptops and touch panels are often on a different VLAN.** That split is normal and works with AbleView.

AbleView does **not** use Ableton Link. It uses **unicast UDP** to AbletonOSC (ports **11000** / **11001**) and **TCP** for operator browsers (`HTTP_PORT`, default **8080**, WebSocket on `/ws`). Unicast and HTTP cross routed VLANs as long as firewalls and routing allow it.

The show box must reach **both** sides:

| Direction | Traffic | Notes |
|---|---|---|
| Show box → Ableton | UDP to `ingest.oscSendPort` (11000) | Set `ingest.abletonHost` to the master’s **Link VLAN IP** |
| Ableton → show box | UDP replies to `ingest.oscListenPort` (11001) | Return path; stateful firewalls usually pinhole automatically |
| Operators → show box | TCP 8080 (HTTP + WebSocket) | Use the show box IP on the **operator VLAN** in the URL table above |
| Show box → Google | TCP 443 | Sheet sync and admin row edits; needs internet on **some** NIC, not necessarily the Link VLAN |

**Recommended:** dual-homed show box — NIC 1 on Link VLAN (static IP, **no default gateway**); NIC 2 on operator/production VLAN (default gateway + internet). Single-NIC on the operator VLAN is OK if routing/ACLs allow UDP to the Link VLAN.

**Before show week, confirm:**

- [ ] `ingest.abletonHost` is the master’s reachable IP (admin settings or `config.json`)
- [ ] Operator URLs use an IP/DNS name that **operator devices** can reach (not `.local` across VLANs)
- [ ] Windows Firewall (or equivalent): allow **inbound TCP 8080** and **UDP 11001** on the show box
- [ ] AbletonOSC on the master listens on the network (not `127.0.0.1` only) and replies to the show box’s IP
- [ ] Dual-homed: only **one** default gateway (operator/internet NIC)

If clips never update but `/health` is fine, suspect OSC path (host IP, firewall, AbletonOSC bind). If browsers cannot connect, suspect operator VLAN → show box TCP 8080. If sheet stays stale, suspect show box → internet (wrong default route on dual-homed boxes is a common cause).

Full install notes: [`deploy/README.md`](./README.md#network-link-vlan-and-operator-vlan).

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
- [ ] `ingest.abletonHost` correct — master’s IP on the **Link VLAN** (or `127.0.0.1` if Ableton on same machine as AbleView)
- [ ] If Link and operator VLANs differ: routing/firewall tested; operator URLs use **operator-reachable** show box IP (see [Ableton Link VLAN vs operator VLAN](#ableton-link-vlan-vs-operator-vlan))

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

### Clips not updating (VLAN / network)

Symptoms: operator views load, WebSocket **Connected**, but **last update** does not move when firing cue clips.

1. From the show box, confirm `ingest.abletonHost` matches the live master IP (admin settings).
2. Verify UDP **11000/11001** between show box and Ableton (firewall on both ends; Link VLAN ACLs).
3. Confirm AbletonOSC is running and bound for remote clients (not localhost-only).
4. Check AbleView logs for OSC errors or “no OSC traffic; re-registering listeners”.

Symptoms: **Disconnected** in the browser while the service is up — operators cannot reach TCP **8080** on the show box IP they use; fix routing or firewall on the **operator VLAN**, or fix the URL (wrong subnet).

---

## Log locations

| OS | Where |
|---|---|
| Windows (NSSM) | `{InstallDir}\logs\stdout.log`, `stderr.log` |
| macOS (launchd) | `{InstallDir}/logs/launchd.log` |
| Optional app log | `LOG_FILE` in `.env` → `./logs/ableview.log` |
| Linux (systemd) | `journalctl -u ableview -f` |

---

## Touch display (operator mini PC)

Copy [`deploy/kiosk/`](./kiosk/) onto a USB stick and double-click `Install-Band.cmd` (or Visuals / Lighting / Admin) on each Windows mini PC. That writes a desktop shortcut and a Startup copy. Details: [`deploy/kiosk/README.md`](./kiosk/README.md).

Manual fallback on the NUC connected to the operator panel:

1. Create a **show user** with auto-login (optional but recommended).
2. Add browser startup: Edge **app mode** (not `--kiosk`) so Exit can close back to the desktop. Include **`?kiosk=1`** for Fullscreen / Reload / Exit. Use **`--start-maximized`** so the window fills the panel immediately (title bar stays until the operator taps **Fullscreen**).

   ```
   "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --user-data-dir="%LOCALAPPDATA%\AbleViewKiosk" --start-maximized --app="http://__SHOW_BOX_IP__:8080/views/band?kiosk=1" --no-first-run --no-default-browser-check --disable-features=Translate
   ```

   `--user-data-dir` keeps this off the everyday Edge profile. If Edge is already running without that flag, `--app=` is often treated as a normal window and in-app Exit cannot close it. Close all Edge windows once before the first launch from this shortcut. `deploy/ableview-kiosk.cmd` wraps the same flags.

   Avoid `--kiosk` / `--edge-kiosk-type=fullscreen` on operator NUCs: that hides Windows chrome but **blocks** in-app Exit (`window.close()` is ignored). Do **not** use `--start-fullscreen` — it is slow and inconsistent with `--app=`.

   Put that shortcut on the desktop and in the Startup folder (`shell:startup`).
3. **Fullscreen** is a single tap (hides the Windows title bar). **Window** (same button, while fullscreen) brings the title bar back. **Reload** is a single tap. **Exit** is hold (~1.5 s) — it leaves fullscreen and closes the browser so the operator can reach Windows. If the browser blocks close, use Alt+F4 (keep a USB keyboard in the kit) or the window **X**.
4. Disable screen sleep and Windows Update forced reboot during show hours.
5. If the browser crashes, restart it — AbleView keeps running as a separate service.

Laptop operators should keep the normal URLs (no `?kiosk=1`) so Fullscreen / Reload / Exit stay hidden.

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
