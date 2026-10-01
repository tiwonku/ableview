import Foundation

/// Computes per-deck on-air from crossfader weight + line volume (M13 §6.2).
///
/// Crossfader normalized 0…1 (0 = full deck 1, 1 = full deck 2).
/// `deck1Weight = 1 - crossfader`, `deck2Weight = crossfader`.
/// A deck is raw-on-air when `weight >= crossfaderThreshold` and
/// `lineVolume >= lineVolumeMin`. Hysteresis holds flips for
/// `hysteresisSeconds` of sustained opposite state.
public struct OnAirDetector: Sendable {
    public var config: OnAirConfig

    private var reported: [Int: Bool] = [:]
    private var pendingRaw: [Int: Bool] = [:]
    private var pendingSince: [Int: Date] = [:]

    public init(config: OnAirConfig = OnAirConfig()) {
        self.config = config
    }

    /// Instantaneous weights without hysteresis (for tests / diagnostics).
    public static func weights(crossfader01: Double?) -> (deck1: Double, deck2: Double) {
        let cf = crossfader01 ?? 0.5
        return (1.0 - cf, cf)
    }

    public static func rawOnAir(
        deckNumber: Int,
        lineVolume01: Double?,
        crossfader01: Double?,
        config: OnAirConfig
    ) -> Bool {
        guard let vol = lineVolume01, vol >= config.lineVolumeMin else {
            return false
        }
        let (w1, w2) = weights(crossfader01: crossfader01)
        let weight = deckNumber == 1 ? w1 : w2
        return weight >= config.crossfaderThreshold
    }

    /// Update one deck; returns hysteretic on-air flag.
    public mutating func update(
        deckNumber: Int,
        lineVolumeRaw: String?,
        crossfaderRaw: String?,
        now: Date = Date()
    ) -> Bool {
        let vol = AXValueParse.normalize01(lineVolumeRaw)
        let cf = AXValueParse.normalize01(crossfaderRaw)
        let raw = Self.rawOnAir(
            deckNumber: deckNumber,
            lineVolume01: vol,
            crossfader01: cf,
            config: config
        )
        return applyHysteresis(deckNumber: deckNumber, raw: raw, now: now)
    }

    /// Convenience for two-deck update.
    public mutating func updateDecks(
        deck1Volume: String?,
        deck2Volume: String?,
        crossfader: String?,
        now: Date = Date()
    ) -> (Bool, Bool) {
        let a = update(
            deckNumber: 1,
            lineVolumeRaw: deck1Volume,
            crossfaderRaw: crossfader,
            now: now
        )
        let b = update(
            deckNumber: 2,
            lineVolumeRaw: deck2Volume,
            crossfaderRaw: crossfader,
            now: now
        )
        return (a, b)
    }

    private mutating func applyHysteresis(deckNumber: Int, raw: Bool, now: Date) -> Bool {
        // First observation adopts immediately (no prior state to protect).
        guard let current = reported[deckNumber] else {
            reported[deckNumber] = raw
            return raw
        }

        if raw == current {
            pendingRaw[deckNumber] = nil
            pendingSince[deckNumber] = nil
            return current
        }

        if pendingRaw[deckNumber] != raw {
            pendingRaw[deckNumber] = raw
            pendingSince[deckNumber] = now
            return current
        }

        guard let since = pendingSince[deckNumber] else {
            pendingSince[deckNumber] = now
            return current
        }

        if now.timeIntervalSince(since) >= config.hysteresisSeconds {
            reported[deckNumber] = raw
            pendingRaw[deckNumber] = nil
            pendingSince[deckNumber] = nil
            return raw
        }

        return current
    }
}
