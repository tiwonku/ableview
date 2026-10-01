import DeckBridgeCore
import Foundation

// MARK: - CLI

var configPath: String?
var verbose = false

var args = Array(CommandLine.arguments.dropFirst())
while !args.isEmpty {
    let a = args.removeFirst()
    switch a {
    case "--config", "-c":
        guard !args.isEmpty else {
            fputs("Missing path after \(a)\n", stderr)
            exit(2)
        }
        configPath = args.removeFirst()
    case "--verbose", "-v":
        verbose = true
    case "--help", "-h":
        print(
            """
            AbleView DeckBridge — djay Pro → UDP JSON (M13a)

            Usage:
              DeckBridge --config /path/to/config.json [--verbose]

            Config keys: sourceId, targetHost, targetPort, reportIntervalMs, onAir{}
            Example: deploy/deck-bridge/config.example.json
            """
        )
        exit(0)
    default:
        fputs("Unknown argument: \(a)\n", stderr)
        exit(2)
    }
}

guard let configPath else {
    fputs("Required: --config /path/to/config.json\n", stderr)
    exit(2)
}

let configURL = URL(fileURLWithPath: configPath)
guard FileManager.default.fileExists(atPath: configURL.path) else {
    fputs("\(ConfigError.fileNotFound(configPath))\n", stderr)
    exit(2)
}

let config: BridgeConfig
do {
    config = try BridgeConfig.load(from: configURL)
} catch {
    fputs("Config error: \(error)\n", stderr)
    exit(2)
}

requestAccessibilityPrompt()

printError(
    "DeckBridge \(DeckBridgeCore.version) sourceId=\(config.sourceId) → \(config.targetHost):\(config.targetPort) every \(config.reportIntervalMs)ms"
)

let sender = UDPSender(host: config.targetHost, port: config.targetPort)

// MARK: - Shared poll state

final class BridgeState: @unchecked Sendable {
    private let lock = NSLock()
    private var deck1 = DeckInfo()
    private var deck2 = DeckInfo()
    private var crossfader: String?
    private var appRunning = false
    private var accessibilityOk = true
    private var onAir1 = false
    private var onAir2 = false
    private var play1 = PlayStateDebouncer()
    private var play2 = PlayStateDebouncer()
    private var onAirDetector: OnAirDetector

    init(onAirConfig: OnAirConfig) {
        self.onAirDetector = OnAirDetector(config: onAirConfig)
    }

    func setOffline() {
        lock.lock()
        appRunning = false
        deck1 = DeckInfo()
        deck2 = DeckInfo()
        crossfader = nil
        onAir1 = false
        onAir2 = false
        lock.unlock()
    }

    func setAccessibilityFailed() {
        lock.lock()
        accessibilityOk = false
        appRunning = false
        lock.unlock()
    }

    func updateFromAX(deck1 raw1: DeckInfo, deck2 raw2: DeckInfo, crossfader: String?) {
        lock.lock()
        accessibilityOk = true
        appRunning = true
        var d1 = raw1
        var d2 = raw2
        d1.isPlaying = play1.update(isPlaying: raw1.isPlaying)
        d2.isPlaying = play2.update(isPlaying: raw2.isPlaying)
        deck1 = d1
        deck2 = d2
        self.crossfader = crossfader
        let pair = onAirDetector.updateDecks(
            deck1Volume: d1.lineVolume,
            deck2Volume: d2.lineVolume,
            crossfader: crossfader
        )
        onAir1 = pair.0
        onAir2 = pair.1
        lock.unlock()
    }

    func snapshot() -> (
        running: Bool,
        axOk: Bool,
        d1: DeckInfo,
        d2: DeckInfo,
        cf: String?,
        o1: Bool,
        o2: Bool
    ) {
        lock.lock()
        defer { lock.unlock() }
        return (appRunning, accessibilityOk, deck1, deck2, crossfader, onAir1, onAir2)
    }
}

let state = BridgeState(onAirConfig: config.onAir)

// MARK: - AX poll thread

let pollQueue = DispatchQueue(label: "ableview.deck-bridge.ax", qos: .userInitiated)
var lastFoundPid: pid_t = 0
var lastAxWarn = Date.distantPast

pollQueue.async {
    while true {
        guard let djay = findDjayPro(quiet: true) else {
            state.setOffline()
            lastFoundPid = 0
            Thread.sleep(forTimeInterval: 0.5)
            continue
        }

        if !checkAccessibilityPermission(djay.element, quiet: true) {
            state.setAccessibilityFailed()
            let now = Date()
            if now.timeIntervalSince(lastAxWarn) > 30 {
                lastAxWarn = now
                printError(
                    "Accessibility not granted — enable DeckBridge in System Settings → Privacy & Security → Accessibility"
                )
            }
            Thread.sleep(forTimeInterval: 1.0)
            continue
        }

        if djay.pid != lastFoundPid {
            lastFoundPid = djay.pid
            printError("Found djay Pro (PID \(djay.pid))")
        }

        let d1 = getDeckInfo(app: djay.element, deckNumber: 1)
        let d2 = getDeckInfo(app: djay.element, deckNumber: 2)
        let cf = getCrossfader(app: djay.element)
        state.updateFromAX(deck1: d1, deck2: d2, crossfader: cf)
    }
}

// MARK: - UDP report loop

signal(SIGINT) { _ in exit(0) }
signal(SIGTERM) { _ in exit(0) }

while true {
    let snap = state.snapshot()
    let report = ReportBuilder.build(
        sourceId: config.sourceId,
        appRunning: snap.running && snap.axOk,
        crossfaderRaw: snap.cf,
        deck1: snap.d1,
        deck2: snap.d2,
        onAir1: snap.o1,
        onAir2: snap.o2
    )

    do {
        let data = try ReportBuilder.encodeJSON(report)
        sender.send(data)
        if verbose, let s = String(data: data, encoding: .utf8) {
            print(s)
        }
    } catch {
        printError("JSON encode failed: \(error)")
    }

    usleep(config.reportIntervalMs * 1000)
}
