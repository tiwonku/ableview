// swift-tools-version: 5.9
// AbleView deck-bridge — macOS Accessibility reader for Algoriddim djay Pro.
// AX reading patterns adapted from djay-pro-bridge (MIT, Kyle Awayan).

import PackageDescription

let package = Package(
    name: "ableview-deck-bridge",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "DeckBridge", targets: ["DeckBridge"]),
        .executable(name: "Dump", targets: ["Dump"]),
        .library(name: "DeckBridgeCore", targets: ["DeckBridgeCore"]),
    ],
    targets: [
        .target(
            name: "DeckBridgeCore",
            path: "Sources/DeckBridgeCore"
        ),
        .executableTarget(
            name: "DeckBridge",
            dependencies: ["DeckBridgeCore"],
            path: "Sources/DeckBridge"
        ),
        .executableTarget(
            name: "Dump",
            dependencies: ["DeckBridgeCore"],
            path: "Sources/Dump"
        ),
        .testTarget(
            name: "DeckBridgeCoreTests",
            dependencies: ["DeckBridgeCore"],
            path: "Tests/DeckBridgeCoreTests"
        ),
    ]
)
