# Deck bridge — show box notes

Dave's Mac uses [`README.md`](./README.md) only. This page is the other source and the show-box side.

The helper runs on each performer Mac, not the show box. It reads djay Pro and sends UDP to the address in its config. The show box listens when `externalSources` lists that `sourceId` and port.

| Mac | Config | sourceId | Port |
|---|---|---|---|
| Dave (default) | `config.example.json` | `tt-samples` | 9102 |
| D | `config.djay-d.example.json` | `djay-d` | 9101 |

`targetHost` in both examples is the show box `10.45.2.107`. Change it if that address changes, before the first install on that Mac. The installer will not overwrite a config that is already in the install folder.

Dave's Mac is the default: run the installer with no `--config`. On D's Mac:

```bash
./deploy/deck-bridge/install-deck-bridge-macos.sh \
  --install-dir ~/AbleView-deck-bridge \
  --config deploy/deck-bridge/config.djay-d.example.json
```

One Mac running both sources needs a separate install directory per source (macOS keys Accessibility to the binary path):

```bash
./deploy/deck-bridge/install-deck-bridge-macos.sh \
  --install-dir ~/AbleView-deck-bridge-tt \
  --config deploy/deck-bridge/config.example.json

./deploy/deck-bridge/install-deck-bridge-macos.sh \
  --install-dir ~/AbleView-deck-bridge-d \
  --config deploy/deck-bridge/config.djay-d.example.json
```

Each folder has its own `uninstall.sh`. `deploy/uninstall-macos.sh` removes the show-box agent (`com.ableview.server`), not these.

Allow inbound UDP **9101** and **9102** on the show box. The Windows installer does not open those ports.

Djay has to stay in the two-deck jog view with timers visible. Some Accessibility fields only exist in that layout. When djay is closed, the helper stays running and reports that the app is not running.

Source and AX notes: [`bridge/deck-bridge/`](../../bridge/deck-bridge/).
