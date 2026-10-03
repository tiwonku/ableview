# Dave — djay on your Mac

This installs a small helper that reads djay Pro and sends the deck info to the show computer. It starts by itself whenever you are logged in. You do not leave Terminal open.

Show computer address: `10.45.2.107`

## Install

1. Open **Terminal**.
2. If this fails, run `xcode-select --install`, click Install, wait until it finishes, then continue:

   ```bash
   swift --version
   ```

3. Go into the `ableview` folder you were given:

   ```bash
   cd ~/Desktop/ableview
   ```

   Use the real path if it is not on the Desktop.

4. Open the config and check that `targetHost` is `10.45.2.107`. Leave `sourceId` as `djay-d` and `targetPort` as `9101`. Save.

   ```bash
   open -e deploy/deck-bridge/config.example.json
   ```

5. Install it. The first run compiles for a few minutes.

   ```bash
   chmod +x deploy/deck-bridge/install-deck-bridge-macos.sh
   ./deploy/deck-bridge/install-deck-bridge-macos.sh --install-dir ~/AbleView-deck-bridge
   ```

6. **System Settings → Privacy & Security → Accessibility.** Click **+**, press **Cmd-Shift-G**, paste this path, and turn it on. Replace `YOURNAME` with your macOS username (`whoami` in Terminal):

   ```text
   /Users/YOURNAME/AbleView-deck-bridge/bin/DeckBridge
   ```

7. If macOS asks DeckBridge for **Local Network** access, allow it. Same place under Privacy & Security if you need to turn it on later.

8. Open djay Pro in the normal two-deck view, jog wheels visible, and the deck timers showing.

Leave the Mac logged in and awake on the show network. djay can be opened and closed; the helper keeps running.

Nick confirms it on the show computer. If it stays offline, send him `~/AbleView-deck-bridge/logs/deck-bridge.log`.

## Remove it later

Quitting the program does not uninstall it. macOS starts it again the next time you log in. To take it off this Mac:

```bash
~/AbleView-deck-bridge/uninstall.sh
```

That deletes the login item and the `AbleView-deck-bridge` folder. Then:

1. **System Settings → Privacy & Security → Accessibility** — select DeckBridge, click the minus button.
2. **Local Network** — turn DeckBridge off if it is listed.

You can also delete the `ableview` folder. Leave Xcode Command Line Tools installed.
