import XCTest
@testable import DeckBridgeCore

final class PlayStateDebouncerTests: XCTestCase {
    func testPausedToPlaying_requiresThreshold() {
        var d = PlayStateDebouncer(threshold: 0.7)
        let t0 = Date(timeIntervalSince1970: 5_000)

        XCTAssertFalse(d.update(isPlaying: true, now: t0))
        XCTAssertFalse(d.update(isPlaying: true, now: t0.addingTimeInterval(0.3)))
        XCTAssertTrue(d.update(isPlaying: true, now: t0.addingTimeInterval(0.7)))
    }

    func testPlayingToPaused_immediate() {
        var d = PlayStateDebouncer(threshold: 0.7)
        let t0 = Date(timeIntervalSince1970: 5_000)
        _ = d.update(isPlaying: true, now: t0)
        _ = d.update(isPlaying: true, now: t0.addingTimeInterval(0.8))
        XCTAssertFalse(d.update(isPlaying: false, now: t0.addingTimeInterval(0.81)))
    }

    func testFlashDuringPause_doesNotReportPlay() {
        var d = PlayStateDebouncer(threshold: 0.7)
        let t0 = Date(timeIntervalSince1970: 5_000)

        // Simulate flashing: short true blips while paused
        XCTAssertFalse(d.update(isPlaying: true, now: t0))
        XCTAssertFalse(d.update(isPlaying: false, now: t0.addingTimeInterval(0.1)))
        XCTAssertFalse(d.update(isPlaying: true, now: t0.addingTimeInterval(0.2)))
        XCTAssertFalse(d.update(isPlaying: false, now: t0.addingTimeInterval(0.3)))
    }
}
