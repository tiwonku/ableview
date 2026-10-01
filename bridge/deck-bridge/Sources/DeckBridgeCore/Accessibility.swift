@preconcurrency import ApplicationServices
import Cocoa
import Foundation

// MARK: - Stderr helper

public func printError(_ message: String) {
    FileHandle.standardError.write(Data((message + "\n").utf8))
}

// MARK: - Find djay Pro

public struct DjayApp {
    public let element: AXUIElement
    public let pid: pid_t
}

/// Locates a running Algoriddim djay process. When `quiet` is true, missing-app
/// is not logged (used by the LaunchAgent poll loop).
public func findDjayPro(quiet: Bool = false) -> DjayApp? {
    let apps = NSWorkspace.shared.runningApplications
    guard let djay = apps.first(where: {
        $0.bundleIdentifier?.localizedCaseInsensitiveContains("algoriddim") == true
            || $0.localizedName?.localizedCaseInsensitiveContains("djay") == true
    }) else {
        if !quiet {
            printError("djay Pro is not running")
        }
        return nil
    }
    let pid = djay.processIdentifier
    return DjayApp(element: AXUIElementCreateApplication(pid), pid: pid)
}

// MARK: - Accessibility permission

/// Returns true when this process can read the target app's AX tree.
public func checkAccessibilityPermission(_ app: AXUIElement, quiet: Bool = false) -> Bool {
    var value: AnyObject?
    let result = AXUIElementCopyAttributeValue(app, kAXChildrenAttribute as CFString, &value)
    if result == .cannotComplete || result == .apiDisabled {
        if !quiet {
            printError("Accessibility permission not granted for this process.")
            printError("  System Settings → Privacy & Security → Accessibility")
            printError("  Enable the DeckBridge binary (or the terminal you used for `swift run`).")
            printError("  See deploy/README.md § Deck bridge.")
        }
        return false
    }
    return true
}

/// Prompt the OS to show the Accessibility permission dialog if needed.
public func requestAccessibilityPrompt() {
    let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
    _ = AXIsProcessTrustedWithOptions(opts)
}

// MARK: - AX helpers

public func getAttr(_ element: AXUIElement, _ attr: String) -> AnyObject? {
    var value: AnyObject?
    let result = AXUIElementCopyAttributeValue(element, attr as CFString, &value)
    return result == .success ? value : nil
}

public func getChildren(_ element: AXUIElement) -> [AXUIElement] {
    guard let children = getAttr(element, kAXChildrenAttribute) as? [AXUIElement] else {
        return []
    }
    return children
}

public func getRole(_ element: AXUIElement) -> String? {
    getAttr(element, kAXRoleAttribute) as? String
}

public func getLabel(_ element: AXUIElement) -> String? {
    getAttr(element, kAXDescriptionAttribute) as? String
}

public func getValue(_ element: AXUIElement) -> String? {
    getAttr(element, kAXValueAttribute) as? String
}

public func getTitle(_ element: AXUIElement) -> String? {
    getAttr(element, kAXTitleAttribute) as? String
}
