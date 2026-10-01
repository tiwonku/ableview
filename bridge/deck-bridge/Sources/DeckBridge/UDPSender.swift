import Foundation
import Network

/// Fire-and-forget UDP datagram sender for DeckBridgeReport JSON.
final class UDPSender {
    private let connection: NWConnection
    private let queue = DispatchQueue(label: "ableview.deck-bridge.udp")

    init(host: String, port: UInt16) {
        let endpoint = NWEndpoint.hostPort(
            host: NWEndpoint.Host(host),
            port: NWEndpoint.Port(rawValue: port)!
        )
        connection = NWConnection(to: endpoint, using: .udp)
        connection.start(queue: queue)
    }

    func send(_ data: Data) {
        connection.send(
            content: data,
            completion: .contentProcessed { error in
                if let error {
                    // Avoid spamming stderr every 100ms; one line is enough for ops.
                    printErrorOnce("UDP send failed: \(error.localizedDescription)")
                }
            }
        )
    }

    func cancel() {
        connection.cancel()
    }
}

private let errorLock = NSLock()
private var lastErrorAt: Date = .distantPast

private func printErrorOnce(_ message: String) {
    errorLock.lock()
    defer { errorLock.unlock() }
    let now = Date()
    if now.timeIntervalSince(lastErrorAt) < 5 { return }
    lastErrorAt = now
    FileHandle.standardError.write(Data((message + "\n").utf8))
}
