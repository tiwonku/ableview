import Foundation

/// Raw per-deck fields read from the Accessibility tree.
public struct DeckInfo: Equatable, Sendable {
    public var key: String?
    public var title: String?
    public var artist: String?
    public var bpm: String?
    public var elapsedTime: String?
    public var remainingTime: String?
    public var bpmPercent: String?
    public var isPlaying: Bool
    public var lineVolume: String?

    public init(
        key: String? = nil,
        title: String? = nil,
        artist: String? = nil,
        bpm: String? = nil,
        elapsedTime: String? = nil,
        remainingTime: String? = nil,
        bpmPercent: String? = nil,
        isPlaying: Bool = false,
        lineVolume: String? = nil
    ) {
        self.key = key
        self.title = title
        self.artist = artist
        self.bpm = bpm
        self.elapsedTime = elapsedTime
        self.remainingTime = remainingTime
        self.bpmPercent = bpmPercent
        self.isPlaying = isPlaying
        self.lineVolume = lineVolume
    }
}

public struct ElementInfo: Sendable {
    public var label: String?
    public var role: String?
    public var value: String?
    public var subrole: String?

    public init(
        label: String? = nil,
        role: String? = nil,
        value: String? = nil,
        subrole: String? = nil
    ) {
        self.label = label
        self.role = role
        self.value = value
        self.subrole = subrole
    }
}

/// On-air heuristic thresholds (M13 §6.2).
public struct OnAirConfig: Equatable, Sendable {
    /// Minimum crossfader weight (0…1) for a deck to count as on-air.
    public var crossfaderThreshold: Double
    /// Minimum line volume (0…1) for a deck to count as on-air.
    public var lineVolumeMin: Double
    /// Hold time before flipping onAir after a sustained change (seconds).
    public var hysteresisSeconds: Double

    public init(
        crossfaderThreshold: Double = 0.08,
        lineVolumeMin: Double = 0.05,
        hysteresisSeconds: Double = 0.08
    ) {
        self.crossfaderThreshold = crossfaderThreshold
        self.lineVolumeMin = lineVolumeMin
        self.hysteresisSeconds = hysteresisSeconds
    }
}

/// Loaded track metadata in a UDP report.
public struct LoadedTrack: Equatable, Sendable, Codable {
    public var title: String
    public var artist: String?

    public init(title: String, artist: String? = nil) {
        self.title = title
        self.artist = artist
    }
}

/// One deck row in `DeckBridgeReport`.
public struct DeckReport: Equatable, Sendable, Codable {
    public var deckIndex: Int
    public var loaded: LoadedTrack?
    public var playing: Bool
    public var onAir: Bool
    public var bpm: Double?
    public var bpmPercent: Double?
    public var key: String?
    public var elapsedDisplay: String?

    public init(
        deckIndex: Int,
        loaded: LoadedTrack? = nil,
        playing: Bool = false,
        onAir: Bool = false,
        bpm: Double? = nil,
        bpmPercent: Double? = nil,
        key: String? = nil,
        elapsedDisplay: String? = nil
    ) {
        self.deckIndex = deckIndex
        self.loaded = loaded
        self.playing = playing
        self.onAir = onAir
        self.bpm = bpm
        self.bpmPercent = bpmPercent
        self.key = key
        self.elapsedDisplay = elapsedDisplay
    }
}

/// Bridge → show box UDP JSON contract (M13 §4.1).
public struct DeckBridgeReport: Equatable, Sendable, Codable {
    public var schemaVersion: Int
    public var sourceId: String
    public var reportedAt: String
    public var bridgeVersion: String
    public var app: AppStatus
    public var crossfader: Double?
    public var decks: [DeckReport]

    public struct AppStatus: Equatable, Sendable, Codable {
        public var name: String
        public var running: Bool

        public init(name: String = "djay-pro", running: Bool) {
            self.name = name
            self.running = running
        }
    }

    public init(
        schemaVersion: Int = 1,
        sourceId: String,
        reportedAt: String,
        bridgeVersion: String,
        app: AppStatus,
        crossfader: Double? = nil,
        decks: [DeckReport]
    ) {
        self.schemaVersion = schemaVersion
        self.sourceId = sourceId
        self.reportedAt = reportedAt
        self.bridgeVersion = bridgeVersion
        self.app = app
        self.crossfader = crossfader
        self.decks = decks
    }
}

public enum DeckBridgeCore {
    public static let version = "0.1.0"
}
