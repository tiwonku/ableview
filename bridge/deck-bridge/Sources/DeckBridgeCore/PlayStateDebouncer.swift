import Foundation

/// Debounces djay Pro's flashing play/pause AX button (~700ms).
/// Adapted from djay-pro-bridge.
public struct PlayStateDebouncer: Sendable {
    private var rawState: Bool = false
    private var reportedState: Bool = false
    private var lastRawChangeTime: Date = .distantPast
    private let threshold: TimeInterval

    public init(threshold: TimeInterval = 0.7) {
        self.threshold = threshold
    }

    /// Paused→playing requires `threshold` seconds of sustained `true`.
    /// Playing→paused is immediate.
    public mutating func update(isPlaying: Bool, now: Date = Date()) -> Bool {
        if isPlaying != rawState {
            rawState = isPlaying
            lastRawChangeTime = now
        }

        if rawState && !reportedState {
            if now.timeIntervalSince(lastRawChangeTime) >= threshold {
                reportedState = true
            }
        } else if !rawState && reportedState {
            reportedState = false
        }

        return reportedState
    }
}
