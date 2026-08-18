# Operator mini-PC kiosk kit

Copy **this whole folder** onto a USB stick. Plug it into each Windows operator mini PC
(keyboard + mouse). Do **not** install Node or AbleView on these boxes.

Show box default: `10.45.2.107:8080`. Edit `ShowBoxHost` in `Install-AbleViewKiosk.ps1` if
that IP changes.

## Per station

1. Finish Windows setup. Plug **wired Ethernet**.
2. If Explorer blocks the stick: right-click `Install-AbleViewKiosk.ps1` → Properties → **Unblock**.
3. Double-click the matching installer:

   | Mini PC | Run |
   |---|---|
   | Band | `Install-Band.cmd` |
   | Visuals | `Install-Visuals.cmd` |
   | Lighting | `Install-Lighting.cmd` |
   | Admin | `Install-Admin.cmd` |

4. SmartScreen: **More info → Run anyway**.
5. Edge should open maximized on that view (**Connected**). Tap **Fullscreen**.
6. Unplug the USB. Reboot — the same shortcut should start on login.

The installer writes a desktop shortcut **and** a copy in the Startup folder. Both target
Edge on `C:`, so they keep working after the stick is removed.

Icons come from built-in Windows DLLs (music / photos / sun / shield). To change one:
right-click the desktop shortcut → Properties → **Change Icon…**, then copy it over the
Startup copy (`Win+R` → `shell:startup`).

Close every normal Edge window once before the first launch from this shortcut, so Exit
can close the app-mode window. Do not use Edge `--kiosk` — it blocks in-app Exit.
