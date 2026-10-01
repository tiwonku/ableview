import XCTest
@testable import DeckBridgeCore

final class OnAirDetectorTests: XCTestCase {
    private let cfg = OnAirConfig(
        crossfaderThreshold: 0.08,
        lineVolumeMin: 0.05,
        hysteresisSeconds: 0.08
    )

    func testWeightsCenter() {
        let w = OnAirDetector.weights(crossfader01: 0.5)
        XCTAssertEqual(w.deck1, 0.5, accuracy: 1e-9)
        XCTAssertEqual(w.deck2, 0.5, accuracy: 1e-9)
    }

    func testWeightsFullDeck1() {
        let w = OnAirDetector.weights(crossfader01: 0)
        XCTAssertEqual(w.deck1, 1.0, accuracy: 1e-9)
        XCTAssertEqual(w.deck2, 0.0, accuracy: 1e-9)
    }

    func testRawOnAir_center_bothAudible() {
        XCTAssertTrue(
            OnAirDetector.rawOnAir(
                deckNumber: 1, lineVolume01: 1.0, crossfader01: 0.5, config: cfg
            )
        )
        XCTAssertTrue(
            OnAirDetector.rawOnAir(
                deckNumber: 2, lineVolume01: 1.0, crossfader01: 0.5, config: cfg
            )
        )
    }

    func testRawOnAir_fullLeft_onlyDeck1() {
        XCTAssertTrue(
            OnAirDetector.rawOnAir(
                deckNumber: 1, lineVolume01: 1.0, crossfader01: 0.0, config: cfg
            )
        )
        XCTAssertFalse(
            OnAirDetector.rawOnAir(
                deckNumber: 2, lineVolume01: 1.0, crossfader01: 0.0, config: cfg
            )
        )
    }

    func testRawOnAir_nearEdge_softCut() {
        // deck2 weight = 0.05 < 0.08
        XCTAssertFalse(
            OnAirDetector.rawOnAir(
                deckNumber: 2, lineVolume01: 1.0, crossfader01: 0.05, config: cfg
            )
        )
        XCTAssertTrue(
            OnAirDetector.rawOnAir(
                deckNumber: 1, lineVolume01: 1.0, crossfader01: 0.05, config: cfg
            )
        )
    }

    func testRawOnAir_mutedLineVolume() {
        XCTAssertFalse(
            OnAirDetector.rawOnAir(
                deckNumber: 1, lineVolume01: 0.0, crossfader01: 0.5, config: cfg
            )
        )
        XCTAssertFalse(
            OnAirDetector.rawOnAir(
                deckNumber: 1, lineVolume01: 0.04, crossfader01: 0.5, config: cfg
            )
        )
    }

    func testHysteresis_holdsBriefFlip() {
        var det = OnAirDetector(config: cfg)
        let t0 = Date(timeIntervalSince1970: 1_000)

        // Establish on-air
        let on = det.update(
            deckNumber: 1,
            lineVolumeRaw: "100%",
            crossfaderRaw: "50%",
            now: t0
        )
        XCTAssertTrue(on)

        // Brief cut below threshold — should still report on within hold
        let mid = det.update(
            deckNumber: 1,
            lineVolumeRaw: "100%",
            crossfaderRaw: "100%", // deck1 weight 0
            now: t0.addingTimeInterval(0.02)
        )
        XCTAssertTrue(mid)

        // Sustained cut past hysteresis
        let off = det.update(
            deckNumber: 1,
            lineVolumeRaw: "100%",
            crossfaderRaw: "100%",
            now: t0.addingTimeInterval(0.10)
        )
        XCTAssertFalse(off)
    }

    func testPercentParsing() {
        XCTAssertEqual(AXValueParse.normalize01("50%")!, 0.5, accuracy: 1e-9)
        XCTAssertEqual(AXValueParse.normalize01("0%")!, 0.0, accuracy: 1e-9)
        XCTAssertEqual(AXValueParse.normalize01("0.35")!, 0.35, accuracy: 1e-9)
    }

    func testReportBuilder_jsonRoundTrip() throws {
        let report = ReportBuilder.build(
            sourceId: "djay-d",
            appRunning: true,
            crossfaderRaw: "35%",
            deck1: DeckInfo(
                key: "e minor",
                title: "Song A",
                artist: "Artist",
                bpm: "124.0",
                elapsedTime: "01:35",
                bpmPercent: "0.0%",
                isPlaying: true,
                lineVolume: "100%"
            ),
            deck2: DeckInfo(title: "Song B", isPlaying: false, lineVolume: "80%"),
            onAir1: true,
            onAir2: false
        )
        let data = try ReportBuilder.encodeJSON(report)
        let decoded = try JSONDecoder().decode(DeckBridgeReport.self, from: data)
        XCTAssertEqual(decoded.schemaVersion, 1)
        XCTAssertEqual(decoded.sourceId, "djay-d")
        XCTAssertEqual(decoded.app.name, "djay-pro")
        XCTAssertTrue(decoded.app.running)
        XCTAssertEqual(decoded.crossfader!, 0.35, accuracy: 1e-9)
        XCTAssertEqual(decoded.decks.count, 2)
        XCTAssertEqual(decoded.decks[0].loaded?.title, "Song A")
        XCTAssertTrue(decoded.decks[0].onAir)
        XCTAssertFalse(decoded.decks[1].onAir)
    }

    func testReportBuilder_pausedDeckIsNotOnAir() throws {
        let report = ReportBuilder.build(
            sourceId: "djay-d",
            appRunning: true,
            crossfaderRaw: "0%",
            deck1: DeckInfo(title: "Song A", isPlaying: false, lineVolume: "100%"),
            deck2: DeckInfo(),
            onAir1: true,
            onAir2: false
        )
        XCTAssertFalse(report.decks[0].playing)
        XCTAssertFalse(report.decks[0].onAir)
    }

    func testReportBuilder_appNotRunning_emptyDecks() throws {
        let report = ReportBuilder.build(
            sourceId: "djay-d",
            appRunning: false,
            crossfaderRaw: nil,
            deck1: DeckInfo(),
            deck2: DeckInfo(),
            onAir1: false,
            onAir2: false
        )
        XCTAssertFalse(report.app.running)
        XCTAssertTrue(report.decks.isEmpty)
    }
}
