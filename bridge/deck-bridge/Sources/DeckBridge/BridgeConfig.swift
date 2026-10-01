import DeckBridgeCore
import Foundation

struct BridgeConfig: Equatable {
    var sourceId: String
    var targetHost: String
    var targetPort: UInt16
    var reportIntervalMs: UInt32
    var onAir: OnAirConfig

    static let `default` = BridgeConfig(
        sourceId: "djay-d",
        targetHost: "127.0.0.1",
        targetPort: 9101,
        reportIntervalMs: 100,
        onAir: OnAirConfig()
    )

    static func load(from url: URL) throws -> BridgeConfig {
        let data = try Data(contentsOf: url)
        guard let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw ConfigError.invalidRoot
        }

        var cfg = BridgeConfig.default

        if let v = obj["sourceId"] as? String, !v.isEmpty { cfg.sourceId = v }
        if let v = obj["targetHost"] as? String, !v.isEmpty { cfg.targetHost = v }
        if let v = obj["targetPort"] as? Int, v > 0, v <= 65535 {
            cfg.targetPort = UInt16(v)
        } else if let v = obj["targetPort"] as? Double, v > 0, v <= 65535 {
            cfg.targetPort = UInt16(v)
        }
        if let v = obj["reportIntervalMs"] as? Int, v > 0 {
            cfg.reportIntervalMs = UInt32(v)
        } else if let v = obj["reportIntervalMs"] as? Double, v > 0 {
            cfg.reportIntervalMs = UInt32(v)
        }

        if let onAir = obj["onAir"] as? [String: Any] {
            if let t = number(onAir["crossfaderThreshold"]) {
                cfg.onAir.crossfaderThreshold = t
            }
            if let t = number(onAir["lineVolumeMin"]) {
                cfg.onAir.lineVolumeMin = t
            }
            if let t = number(onAir["hysteresisMs"]) {
                cfg.onAir.hysteresisSeconds = t / 1000.0
            } else if let t = number(onAir["hysteresisSeconds"]) {
                cfg.onAir.hysteresisSeconds = t
            }
        }

        try cfg.validate()
        return cfg
    }

    func validate() throws {
        if sourceId.isEmpty { throw ConfigError.missingSourceId }
        if targetHost.isEmpty { throw ConfigError.missingTargetHost }
        if targetPort == 0 { throw ConfigError.invalidPort }
        if reportIntervalMs == 0 { throw ConfigError.invalidInterval }
    }

    private static func number(_ any: Any?) -> Double? {
        if let d = any as? Double { return d }
        if let i = any as? Int { return Double(i) }
        if let n = any as? NSNumber { return n.doubleValue }
        return nil
    }
}

enum ConfigError: Error, CustomStringConvertible {
    case invalidRoot
    case missingSourceId
    case missingTargetHost
    case invalidPort
    case invalidInterval
    case fileNotFound(String)

    var description: String {
        switch self {
        case .invalidRoot: return "Config root must be a JSON object"
        case .missingSourceId: return "sourceId is required"
        case .missingTargetHost: return "targetHost is required"
        case .invalidPort: return "targetPort must be 1…65535"
        case .invalidInterval: return "reportIntervalMs must be > 0"
        case .fileNotFound(let p): return "Config file not found: \(p)"
        }
    }
}
