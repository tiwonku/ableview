import DeckBridgeCore
import Foundation

// Debug helper: dump djay Pro AX elements as JSON (adapted from djay-pro-bridge Dump).

guard let djay = findDjayPro() else { exit(1) }
guard checkAccessibilityPermission(djay.element) else { exit(1) }

guard let decksGroup = findDecksGroup(djay.element) else {
    printError("Could not find the Decks group in djay Pro's accessibility tree")
    exit(1)
}

let grouped = getAllElements(decksGroup: decksGroup)

let formatter = ISO8601DateFormatter()
formatter.formatOptions = [.withInternetDateTime]

var decksDict: [String: Any] = [:]
var otherArray: [[String: Any]] = []

for (key, elements) in grouped {
    let mapped = elements.map { el -> [String: Any] in
        var dict: [String: Any] = [:]
        if let l = el.label { dict["label"] = l }
        if let r = el.role { dict["role"] = r }
        if let v = el.value { dict["value"] = v }
        if let s = el.subrole { dict["subrole"] = s }
        return dict
    }
    if key == "other" {
        otherArray = mapped
    } else {
        decksDict[key] = mapped
    }
}

let output: [String: Any] = [
    "timestamp": formatter.string(from: Date()),
    "djay_pid": Int(djay.pid),
    "decks": decksDict,
    "other": otherArray,
]

let jsonData = try JSONSerialization.data(
    withJSONObject: output,
    options: [.prettyPrinted, .sortedKeys]
)
if let jsonString = String(data: jsonData, encoding: .utf8) {
    print(jsonString)
}
