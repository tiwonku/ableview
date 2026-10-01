# ableview-deck-bridge

macOS sidecar that reads Algoriddim **djay Pro** deck state via Accessibility and
sends `DeckBridgeReport` JSON over UDP to the AbleView show box.

Part of **M13** — see [`docs/plans/M13-external-deck-monitor.md`](../../docs/plans/M13-external-deck-monitor.md).
Install and Accessibility steps: [`deploy/README.md`](../../deploy/README.md#deck-bridge-djay-pro-performer-mac).

## Build

```bash
cd bridge/deck-bridge
swift build -c release
```

Binary: `.build/release/DeckBridge`

## Run (dev)

```bash
cp ../../deploy/deck-bridge/config.example.json /tmp/deck-bridge.json
# edit targetHost / targetPort / sourceId
swift run DeckBridge --config /tmp/deck-bridge.json
```

On the show box (or locally):

```bash
nc -u -l 9101
```

## Dump AX tree (debug)

```bash
swift run Dump
```

## Tests

```bash
swift test
```

## Attribution

AX patterns adapted from [djay-pro-bridge](https://github.com/kyleawayan/djay-pro-bridge)
(MIT). See [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).
