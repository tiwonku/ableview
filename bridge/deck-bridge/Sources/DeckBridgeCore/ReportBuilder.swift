import Foundation

/// Builds a `DeckBridgeReport` from debounced AX snapshots.
public enum ReportBuilder {
    private static let isoFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    public static func isoNow(_ date: Date = Date()) -> String {
        isoFormatter.string(from: date)
    }

    public static func build(
        sourceId: String,
        bridgeVersion: String = DeckBridgeCore.version,
        appRunning: Bool,
        crossfaderRaw: String?,
        deck1: DeckInfo,
        deck2: DeckInfo,
        onAir1: Bool,
        onAir2: Bool,
        reportedAt: Date = Date()
    ) -> DeckBridgeReport {
        let cf = AXValueParse.normalize01(crossfaderRaw)
        let decks: [DeckReport] = appRunning
            ? [
                makeDeck(index: 1, info: deck1, onAir: onAir1),
                makeDeck(index: 2, info: deck2, onAir: onAir2),
            ]
            : []

        return DeckBridgeReport(
            schemaVersion: 1,
            sourceId: sourceId,
            reportedAt: isoNow(reportedAt),
            bridgeVersion: bridgeVersion,
            app: .init(name: "djay-pro", running: appRunning),
            crossfader: cf,
            decks: decks
        )
    }

    public static func makeDeck(index: Int, info: DeckInfo, onAir: Bool) -> DeckReport {
        let loaded: LoadedTrack?
        if let title = info.title?.trimmingCharacters(in: .whitespacesAndNewlines), !title.isEmpty {
            loaded = LoadedTrack(title: title, artist: emptyToNil(info.artist))
        } else {
            loaded = nil
        }

        return DeckReport(
            deckIndex: index,
            loaded: loaded,
            playing: info.isPlaying,
            // Mixer position alone is not on-air. A paused deck is silent.
            onAir: onAir && info.isPlaying,
            bpm: AXValueParse.parseDouble(info.bpm),
            bpmPercent: AXValueParse.parseDouble(info.bpmPercent),
            key: emptyToNil(info.key),
            elapsedDisplay: emptyToNil(info.elapsedTime)
        )
    }

    private static func emptyToNil(_ s: String?) -> String? {
        guard let t = s?.trimmingCharacters(in: .whitespacesAndNewlines), !t.isEmpty else {
            return nil
        }
        return t
    }

    public static func encodeJSON(_ report: DeckBridgeReport) throws -> Data {
        let enc = JSONEncoder()
        enc.outputFormatting = [.sortedKeys]
        var data = try enc.encode(report)
        // Trailing newline keeps `nc -u -l` readable; ingest should trim.
        data.append(contentsOf: [0x0A])
        return data
    }
}
