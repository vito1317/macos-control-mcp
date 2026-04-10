#!/usr/bin/env swift
// MacControl.swift — Native macOS control helper for macos-control-mcp
// Provides: mouse control, keyboard input, window management, accessibility tree, screen info
// Author: vito1317 <service@vito1317.com>

import Cocoa
import CoreGraphics
import ApplicationServices
import Foundation

// MARK: - JSON Output Helpers

func jsonOutput(_ dict: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: dict, options: [.sortedKeys]),
       let str = String(data: data, encoding: .utf8) {
        print(str)
    }
}

func jsonError(_ message: String) {
    jsonOutput(["success": false, "error": message])
}

func jsonSuccess(_ data: [String: Any] = [:]) {
    var result: [String: Any] = ["success": true]
    for (key, value) in data {
        result[key] = value
    }
    jsonOutput(result)
}

// MARK: - Mouse Control

func mouseMove(x: Double, y: Double) {
    let point = CGPoint(x: x, y: y)
    let event = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left)
    event?.post(tap: .cghidEventTap)
    jsonSuccess(["action": "mouse_move", "x": x, "y": y])
}

func mouseClick(x: Double, y: Double, button: String = "left", clickCount: Int = 1) {
    let point = CGPoint(x: x, y: y)

    let (downType, upType, cgButton): (CGEventType, CGEventType, CGMouseButton) = {
        switch button {
        case "right": return (.rightMouseDown, .rightMouseUp, .right)
        case "middle": return (.otherMouseDown, .otherMouseUp, .center)
        default: return (.leftMouseDown, .leftMouseUp, .left)
        }
    }()

    // Move to position first
    let moveEvent = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left)
    moveEvent?.post(tap: .cghidEventTap)
    usleep(50000) // 50ms delay

    for i in 1...clickCount {
        let downEvent = CGEvent(mouseEventSource: nil, mouseType: downType, mouseCursorPosition: point, mouseButton: cgButton)
        downEvent?.setIntegerValueField(.mouseEventClickState, value: Int64(i))
        downEvent?.post(tap: .cghidEventTap)

        usleep(30000) // 30ms hold

        let upEvent = CGEvent(mouseEventSource: nil, mouseType: upType, mouseCursorPosition: point, mouseButton: cgButton)
        upEvent?.setIntegerValueField(.mouseEventClickState, value: Int64(i))
        upEvent?.post(tap: .cghidEventTap)

        if i < clickCount { usleep(50000) }
    }

    jsonSuccess(["action": "mouse_click", "x": x, "y": y, "button": button, "clicks": clickCount])
}

func mouseDrag(fromX: Double, fromY: Double, toX: Double, toY: Double, duration: Double = 0.5) {
    let from = CGPoint(x: fromX, y: fromY)
    let to = CGPoint(x: toX, y: toY)
    let steps = max(Int(duration * 60), 10) // ~60fps

    // Mouse down at start
    let downEvent = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: from, mouseButton: .left)
    downEvent?.post(tap: .cghidEventTap)
    usleep(50000)

    // Interpolate movement
    for i in 1...steps {
        let t = Double(i) / Double(steps)
        let currentX = fromX + (toX - fromX) * t
        let currentY = fromY + (toY - fromY) * t
        let current = CGPoint(x: currentX, y: currentY)

        let dragEvent = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDragged, mouseCursorPosition: current, mouseButton: .left)
        dragEvent?.post(tap: .cghidEventTap)
        usleep(UInt32(duration / Double(steps) * 1_000_000))
    }

    // Mouse up at end
    let upEvent = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: to, mouseButton: .left)
    upEvent?.post(tap: .cghidEventTap)

    jsonSuccess(["action": "mouse_drag", "from": ["x": fromX, "y": fromY], "to": ["x": toX, "y": toY]])
}

func mouseScroll(x: Double, y: Double, deltaX: Int, deltaY: Int) {
    let point = CGPoint(x: x, y: y)
    // Move to position first
    let moveEvent = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left)
    moveEvent?.post(tap: .cghidEventTap)
    usleep(50000)

    let scrollEvent = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 2, wheel1: Int32(deltaY), wheel2: Int32(deltaX), wheel3: 0)
    scrollEvent?.post(tap: .cghidEventTap)

    jsonSuccess(["action": "mouse_scroll", "x": x, "y": y, "deltaX": deltaX, "deltaY": deltaY])
}

func mousePosition() {
    let pos = NSEvent.mouseLocation
    let screenHeight = NSScreen.main?.frame.height ?? 0
    // Convert from bottom-left (AppKit) to top-left (CoreGraphics) coordinates
    let cgY = screenHeight - pos.y
    jsonSuccess(["action": "mouse_position", "x": pos.x, "y": cgY, "appkit_y": pos.y])
}

// MARK: - Keyboard Control

let keyCodeMap: [String: UInt16] = [
    "return": 0x24, "enter": 0x24, "tab": 0x30, "space": 0x31,
    "delete": 0x33, "backspace": 0x33, "escape": 0x35, "esc": 0x35,
    "command": 0x37, "cmd": 0x37, "shift": 0x38, "capslock": 0x39,
    "option": 0x3A, "alt": 0x3A, "control": 0x3B, "ctrl": 0x3B,
    "rightshift": 0x3C, "rightoption": 0x3D, "rightcontrol": 0x3E,
    "function": 0x3F, "fn": 0x3F,
    "f1": 0x7A, "f2": 0x78, "f3": 0x63, "f4": 0x76,
    "f5": 0x60, "f6": 0x61, "f7": 0x62, "f8": 0x64,
    "f9": 0x65, "f10": 0x6D, "f11": 0x67, "f12": 0x6F,
    "up": 0x7E, "down": 0x7D, "left": 0x7B, "right": 0x7C,
    "home": 0x73, "end": 0x77, "pageup": 0x74, "pagedown": 0x79,
    "a": 0x00, "b": 0x0B, "c": 0x08, "d": 0x02, "e": 0x0E,
    "f": 0x03, "g": 0x05, "h": 0x04, "i": 0x22, "j": 0x26,
    "k": 0x28, "l": 0x25, "m": 0x2E, "n": 0x2D, "o": 0x1F,
    "p": 0x23, "q": 0x0C, "r": 0x0F, "s": 0x01, "t": 0x11,
    "u": 0x20, "v": 0x09, "w": 0x0D, "x": 0x07, "y": 0x10,
    "z": 0x06,
    "0": 0x1D, "1": 0x12, "2": 0x13, "3": 0x14, "4": 0x15,
    "5": 0x17, "6": 0x16, "7": 0x1A, "8": 0x1C, "9": 0x19,
    "-": 0x1B, "=": 0x18, "[": 0x21, "]": 0x1E,
    ";": 0x29, "'": 0x27, "\\": 0x2A, ",": 0x2B,
    ".": 0x2F, "/": 0x2C, "`": 0x32
]

func keyboardType(text: String, intervalMs: Int = 50) {
    for char in text {
        let src = CGEventSource(stateID: .hidSystemState)
        let keyDown = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: true)
        let keyUp = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: false)

        var utf16 = Array(String(char).utf16)
        keyDown?.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: &utf16)
        keyUp?.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: &utf16)

        keyDown?.post(tap: .cghidEventTap)
        keyUp?.post(tap: .cghidEventTap)
        usleep(UInt32(intervalMs) * 1000)
    }
    jsonSuccess(["action": "keyboard_type", "text": text, "length": text.count])
}

func keyboardPress(key: String, modifiers: [String] = []) {
    guard let keyCode = keyCodeMap[key.lowercased()] else {
        jsonError("Unknown key: \(key). Available: \(keyCodeMap.keys.sorted().joined(separator: ", "))")
        return
    }

    var flags: CGEventFlags = []
    for mod in modifiers {
        switch mod.lowercased() {
        case "command", "cmd": flags.insert(.maskCommand)
        case "shift": flags.insert(.maskShift)
        case "option", "alt": flags.insert(.maskAlternate)
        case "control", "ctrl": flags.insert(.maskControl)
        case "fn", "function": flags.insert(.maskSecondaryFn)
        default: break
        }
    }

    let src = CGEventSource(stateID: .hidSystemState)
    let keyDown = CGEvent(keyboardEventSource: src, virtualKey: keyCode, keyDown: true)
    let keyUp = CGEvent(keyboardEventSource: src, virtualKey: keyCode, keyDown: false)

    if !flags.isEmpty {
        keyDown?.flags = flags
        keyUp?.flags = flags
    }

    keyDown?.post(tap: .cghidEventTap)
    usleep(30000)
    keyUp?.post(tap: .cghidEventTap)

    jsonSuccess(["action": "keyboard_press", "key": key, "modifiers": modifiers])
}

func keyboardHotkey(keys: [String]) {
    guard keys.count >= 2 else {
        jsonError("Hotkey requires at least 2 keys (e.g., cmd+c)")
        return
    }

    let modifiers = Array(keys.dropLast())
    let key = keys.last!
    keyboardPress(key: key, modifiers: modifiers)
}

// MARK: - Screen Info

func screenInfo() {
    var screens: [[String: Any]] = []
    for (i, screen) in NSScreen.screens.enumerated() {
        let frame = screen.frame
        let visibleFrame = screen.visibleFrame
        screens.append([
            "index": i,
            "isMain": screen == NSScreen.main,
            "frame": ["x": frame.origin.x, "y": frame.origin.y, "width": frame.width, "height": frame.height],
            "visibleFrame": ["x": visibleFrame.origin.x, "y": visibleFrame.origin.y, "width": visibleFrame.width, "height": visibleFrame.height],
            "scaleFactor": screen.backingScaleFactor
        ])
    }
    jsonSuccess(["action": "screen_info", "screens": screens, "count": screens.count])
}

// MARK: - Window Management

func windowList() {
    let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    guard let windowInfoList = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
        jsonError("Failed to get window list")
        return
    }

    var windows: [[String: Any]] = []
    for info in windowInfoList {
        let ownerName = info[kCGWindowOwnerName as String] as? String ?? ""
        let windowName = info[kCGWindowName as String] as? String ?? ""
        let windowID = info[kCGWindowNumber as String] as? Int ?? 0
        let layer = info[kCGWindowLayer as String] as? Int ?? 0
        let boundsDict = info[kCGWindowBounds as String] as? [String: Any] ?? [:]
        let pid = info[kCGWindowOwnerPID as String] as? Int ?? 0
        let alpha = info[kCGWindowAlpha as String] as? Double ?? 1.0

        // Skip system UI elements and menubar
        if layer != 0 { continue }
        if ownerName.isEmpty { continue }

        windows.append([
            "windowID": windowID,
            "ownerName": ownerName,
            "windowName": windowName,
            "pid": pid,
            "bounds": boundsDict,
            "alpha": alpha
        ])
    }

    jsonSuccess(["action": "window_list", "windows": windows, "count": windows.count])
}

func windowFocus(appName: String) {
    let apps = NSWorkspace.shared.runningApplications.filter {
        $0.localizedName?.lowercased().contains(appName.lowercased()) ?? false
    }

    guard let app = apps.first else {
        jsonError("App not found: \(appName)")
        return
    }

    app.activate()
    jsonSuccess(["action": "window_focus", "app": app.localizedName ?? appName, "pid": app.processIdentifier])
}

func windowResize(appName: String, x: Double, y: Double, width: Double, height: Double) {
    let script = """
    tell application "\(appName)"
        activate
        set bounds of front window to {\(Int(x)), \(Int(y)), \(Int(x + width)), \(Int(y + height))}
    end tell
    """

    let task = Process()
    task.launchPath = "/usr/bin/osascript"
    task.arguments = ["-e", script]
    let pipe = Pipe()
    task.standardOutput = pipe
    task.standardError = pipe
    task.launch()
    task.waitUntilExit()

    if task.terminationStatus == 0 {
        jsonSuccess(["action": "window_resize", "app": appName, "x": x, "y": y, "width": width, "height": height])
    } else {
        let errorData = pipe.fileHandleForReading.readDataToEndOfFile()
        let errorStr = String(data: errorData, encoding: .utf8) ?? "Unknown error"
        jsonError("Failed to resize window: \(errorStr)")
    }
}

func windowMinimize(appName: String) {
    let script = """
    tell application "\(appName)"
        set miniaturized of front window to true
    end tell
    """
    let task = Process()
    task.launchPath = "/usr/bin/osascript"
    task.arguments = ["-e", script]
    task.launch()
    task.waitUntilExit()
    jsonSuccess(["action": "window_minimize", "app": appName])
}

func windowClose(appName: String) {
    let script = """
    tell application "\(appName)"
        close front window
    end tell
    """
    let task = Process()
    task.launchPath = "/usr/bin/osascript"
    task.arguments = ["-e", script]
    task.launch()
    task.waitUntilExit()
    jsonSuccess(["action": "window_close", "app": appName])
}

// MARK: - Accessibility

func accessibilityCheck() {
    let trusted = AXIsProcessTrusted()
    jsonSuccess(["action": "accessibility_check", "trusted": trusted,
                 "message": trusted ? "Accessibility access is granted" : "Please grant Accessibility access in System Preferences > Privacy & Security > Accessibility"])
}

func accessibilityTree(pid: Int32? = nil, maxDepth: Int = 3) {
    let targetPid: Int32

    if let p = pid {
        targetPid = p
    } else {
        // Get frontmost application
        guard let frontApp = NSWorkspace.shared.frontmostApplication else {
            jsonError("No frontmost application found")
            return
        }
        targetPid = frontApp.processIdentifier
    }

    let appElement = AXUIElementCreateApplication(targetPid)
    let tree = buildAccessibilityTree(element: appElement, depth: 0, maxDepth: maxDepth)

    let appName = NSRunningApplication(processIdentifier: targetPid)?.localizedName ?? "Unknown"
    jsonSuccess(["action": "accessibility_tree", "pid": targetPid, "app": appName, "tree": tree])
}

func buildAccessibilityTree(element: AXUIElement, depth: Int, maxDepth: Int) -> [String: Any] {
    var result: [String: Any] = [:]

    // Get role
    var roleValue: AnyObject?
    AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &roleValue)
    result["role"] = (roleValue as? String) ?? "unknown"

    // Get title
    var titleValue: AnyObject?
    AXUIElementCopyAttributeValue(element, kAXTitleAttribute as CFString, &titleValue)
    if let title = titleValue as? String, !title.isEmpty {
        result["title"] = title
    }

    // Get value
    var valueObj: AnyObject?
    AXUIElementCopyAttributeValue(element, kAXValueAttribute as CFString, &valueObj)
    if let value = valueObj as? String, !value.isEmpty {
        result["value"] = value
    }

    // Get description
    var descValue: AnyObject?
    AXUIElementCopyAttributeValue(element, kAXDescriptionAttribute as CFString, &descValue)
    if let desc = descValue as? String, !desc.isEmpty {
        result["description"] = desc
    }

    // Get role description
    var roleDescValue: AnyObject?
    AXUIElementCopyAttributeValue(element, kAXRoleDescriptionAttribute as CFString, &roleDescValue)
    if let roleDesc = roleDescValue as? String, !roleDesc.isEmpty {
        result["roleDescription"] = roleDesc
    }

    // Get identifier
    var identValue: AnyObject?
    AXUIElementCopyAttributeValue(element, kAXIdentifierAttribute as CFString, &identValue)
    if let identifier = identValue as? String, !identifier.isEmpty {
        result["identifier"] = identifier
    }

    // Get position
    var positionValue: AnyObject?
    AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &positionValue)
    if let posAx = positionValue {
        var point = CGPoint.zero
        AXValueGetValue(posAx as! AXValue, .cgPoint, &point)
        result["position"] = ["x": point.x, "y": point.y]
    }

    // Get size
    var sizeValue: AnyObject?
    AXUIElementCopyAttributeValue(element, kAXSizeAttribute as CFString, &sizeValue)
    if let sizeAx = sizeValue {
        var size = CGSize.zero
        AXValueGetValue(sizeAx as! AXValue, .cgSize, &size)
        result["size"] = ["width": size.width, "height": size.height]
    }

    // Get enabled state
    var enabledValue: AnyObject?
    AXUIElementCopyAttributeValue(element, kAXEnabledAttribute as CFString, &enabledValue)
    if let enabled = enabledValue as? Bool {
        result["enabled"] = enabled
    }

    // Get focused state
    var focusedValue: AnyObject?
    AXUIElementCopyAttributeValue(element, kAXFocusedAttribute as CFString, &focusedValue)
    if let focused = focusedValue as? Bool {
        result["focused"] = focused
    }

    // Recurse into children
    if depth < maxDepth {
        var childrenValue: AnyObject?
        AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &childrenValue)
        if let children = childrenValue as? [AXUIElement] {
            var childTrees: [[String: Any]] = []
            for child in children {
                childTrees.append(buildAccessibilityTree(element: child, depth: depth + 1, maxDepth: maxDepth))
            }
            if !childTrees.isEmpty {
                result["children"] = childTrees
                result["childCount"] = childTrees.count
            }
        }
    }

    return result
}

func accessibilityFocusedPosition() {
    // Get the focused UI element from the frontmost app
    guard let frontApp = NSWorkspace.shared.frontmostApplication else {
        jsonError("No frontmost application found")
        return
    }
    let appElement = AXUIElementCreateApplication(frontApp.processIdentifier)

    // Get the focused element
    var focusedValue: AnyObject?
    let focusResult = AXUIElementCopyAttributeValue(appElement, kAXFocusedUIElementAttribute as CFString, &focusedValue)
    guard focusResult == .success, let focusedElement = focusedValue else {
        jsonError("No focused element found")
        return
    }

    let focused = focusedElement as! AXUIElement

    // Try to get the text cursor (caret) screen position via AXSelectedTextRange + AXBoundsForRange
    var rangeValue: AnyObject?
    let rangeResult = AXUIElementCopyAttributeValue(focused, kAXSelectedTextRangeAttribute as CFString, &rangeValue)

    if rangeResult == .success, let rangeAx = rangeValue {
        // Get a zero-length range at the cursor position for caret bounds
        var selRange = CFRange(location: 0, length: 0)
        AXValueGetValue(rangeAx as! AXValue, .cfRange, &selRange)

        // Create a zero-length range at cursor location to get caret position
        var caretRange = CFRange(location: selRange.location, length: 0)
        guard let caretRangeValue = AXValueCreate(.cfRange, &caretRange) else {
            // Fallback to element position
            fallbackToElementPosition(focused)
            return
        }

        // Use parameterized attribute to get bounds for the range
        var boundsValue: AnyObject?
        let boundsResult = AXUIElementCopyParameterizedAttributeValue(
            focused,
            kAXBoundsForRangeParameterizedAttribute as CFString,
            caretRangeValue,
            &boundsValue
        )

        if boundsResult == .success, let boundsAx = boundsValue {
            var rect = CGRect.zero
            AXValueGetValue(boundsAx as! AXValue, .cgRect, &rect)
            // AXBoundsForRange returns top-left origin (same as kAXPosition)
            // No coordinate conversion needed
            let result: [String: Any] = [
                "success": true,
                "action": "focused_position",
                "source": "caret",
                "x": rect.origin.x + rect.size.width / 2,
                "y": rect.origin.y + rect.size.height / 2,
                "width": rect.size.width,
                "height": rect.size.height,
                "app": frontApp.localizedName ?? "Unknown"
            ]
            jsonSuccess(result)
            return
        }
    }

    // Fallback: use the focused element's position + size
    fallbackToElementPosition(focused)
}

func fallbackToElementPosition(_ element: AXUIElement) {
    var positionValue: AnyObject?
    AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &positionValue)
    var sizeValue: AnyObject?
    AXUIElementCopyAttributeValue(element, kAXSizeAttribute as CFString, &sizeValue)

    if let posAx = positionValue, let sizeAx = sizeValue {
        var point = CGPoint.zero
        var size = CGSize.zero
        AXValueGetValue(posAx as! AXValue, .cgPoint, &point)
        AXValueGetValue(sizeAx as! AXValue, .cgSize, &size)

        // AXPosition is already top-left origin, no conversion needed
        let result: [String: Any] = [
            "success": true,
            "action": "focused_position",
            "source": "element",
            "x": point.x + size.width / 2,
            "y": point.y + size.height / 2,
            "width": size.width,
            "height": size.height,
            "app": NSWorkspace.shared.frontmostApplication?.localizedName ?? "Unknown"
        ]
        jsonSuccess(result)
        return
    }

    jsonError("Could not determine focused element position")
}

func accessibilityElementAtPoint(x: Double, y: Double) {
    let point = CGPoint(x: x, y: y)
    let systemElement = AXUIElementCreateSystemWide()

    var elementRef: AXUIElement?
    let result = AXUIElementCopyElementAtPosition(systemElement, Float(point.x), Float(point.y), &elementRef)

    guard result == .success, let element = elementRef else {
        jsonError("No element found at position (\(x), \(y))")
        return
    }

    let tree = buildAccessibilityTree(element: element, depth: 0, maxDepth: 1)
    jsonSuccess(["action": "accessibility_element_at", "x": x, "y": y, "element": tree])
}

func accessibilityClickElement(role: String, title: String?, appPid: Int32? = nil) {
    let targetPid: Int32
    if let p = appPid {
        targetPid = p
    } else {
        guard let frontApp = NSWorkspace.shared.frontmostApplication else {
            jsonError("No frontmost application found")
            return
        }
        targetPid = frontApp.processIdentifier
    }

    let appElement = AXUIElementCreateApplication(targetPid)
    if let found = findElement(element: appElement, role: role, title: title, depth: 0, maxDepth: 10) {
        AXUIElementPerformAction(found, kAXPressAction as CFString)
        jsonSuccess(["action": "accessibility_click", "role": role, "title": title ?? ""])
    } else {
        jsonError("Element not found: role=\(role), title=\(title ?? "any")")
    }
}

func findElement(element: AXUIElement, role: String, title: String?, depth: Int, maxDepth: Int) -> AXUIElement? {
    var roleValue: AnyObject?
    AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &roleValue)
    let currentRole = (roleValue as? String) ?? ""

    var titleValue: AnyObject?
    AXUIElementCopyAttributeValue(element, kAXTitleAttribute as CFString, &titleValue)
    let currentTitle = titleValue as? String

    if currentRole.lowercased() == role.lowercased() {
        if title == nil || (currentTitle?.lowercased().contains(title!.lowercased()) ?? false) {
            return element
        }
    }

    if depth >= maxDepth { return nil }

    var childrenValue: AnyObject?
    AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &childrenValue)
    if let children = childrenValue as? [AXUIElement] {
        for child in children {
            if let found = findElement(element: child, role: role, title: title, depth: depth + 1, maxDepth: maxDepth) {
                return found
            }
        }
    }

    return nil
}

// MARK: - Running Applications

func listApps() {
    let apps = NSWorkspace.shared.runningApplications
        .filter { $0.activationPolicy == .regular }
        .map { app -> [String: Any] in
            return [
                "name": app.localizedName ?? "Unknown",
                "pid": app.processIdentifier,
                "bundleID": app.bundleIdentifier ?? "",
                "isActive": app.isActive,
                "isHidden": app.isHidden
            ]
        }
    jsonSuccess(["action": "list_apps", "apps": apps, "count": apps.count])
}

// MARK: - Clipboard

func clipboardRead() {
    let pasteboard = NSPasteboard.general
    let text = pasteboard.string(forType: .string) ?? ""
    jsonSuccess(["action": "clipboard_read", "text": text])
}

func clipboardWrite(text: String) {
    let pasteboard = NSPasteboard.general
    pasteboard.clearContents()
    pasteboard.setString(text, forType: .string)
    jsonSuccess(["action": "clipboard_write", "text": text])
}

// MARK: - Main CLI

func printUsage() {
    let usage = """
    MacControl — Native macOS control helper

    Usage: mac-control <command> [options]

    Commands:
      mouse move <x> <y>                          Move mouse to coordinates
      mouse click <x> <y> [button] [clicks]       Click at coordinates (button: left/right/middle)
      mouse drag <fromX> <fromY> <toX> <toY>      Drag from one point to another
      mouse scroll <x> <y> <deltaX> <deltaY>      Scroll at coordinates
      mouse position                               Get current mouse position

      keyboard type <text>                         Type text string
      keyboard press <key> [mod1] [mod2] ...       Press key with optional modifiers
      keyboard hotkey <key1+key2+...>              Press hotkey combination (e.g., cmd+c)

      screen info                                  Get screen/display information

      window list                                  List visible windows
      window focus <appName>                       Focus/activate application
      window resize <app> <x> <y> <w> <h>          Resize application window
      window minimize <appName>                    Minimize front window
      window close <appName>                       Close front window

      accessibility check                          Check accessibility permissions
      accessibility tree [pid] [maxDepth]          Get accessibility tree
      accessibility element-at <x> <y>             Get element at screen position
      accessibility click <role> [title] [pid]     Click accessibility element

      apps list                                    List running applications

      clipboard read                               Read clipboard text
      clipboard write <text>                       Write text to clipboard
    """
    print(usage)
}

// MARK: - Argument Parsing & Dispatch

let args = CommandLine.arguments
guard args.count >= 2 else {
    printUsage()
    exit(1)
}

let command = args[1]
let subcommand = args.count >= 3 ? args[2] : ""

switch command {
case "mouse":
    switch subcommand {
    case "move":
        guard args.count >= 5, let x = Double(args[3]), let y = Double(args[4]) else {
            jsonError("Usage: mouse move <x> <y>"); exit(1)
        }
        mouseMove(x: x, y: y)

    case "click":
        guard args.count >= 5, let x = Double(args[3]), let y = Double(args[4]) else {
            jsonError("Usage: mouse click <x> <y> [button] [clicks]"); exit(1)
        }
        let button = args.count >= 6 ? args[5] : "left"
        let clicks = args.count >= 7 ? Int(args[6]) ?? 1 : 1
        mouseClick(x: x, y: y, button: button, clickCount: clicks)

    case "drag":
        guard args.count >= 7,
              let fx = Double(args[3]), let fy = Double(args[4]),
              let tx = Double(args[5]), let ty = Double(args[6]) else {
            jsonError("Usage: mouse drag <fromX> <fromY> <toX> <toY>"); exit(1)
        }
        let duration = args.count >= 8 ? Double(args[7]) ?? 0.5 : 0.5
        mouseDrag(fromX: fx, fromY: fy, toX: tx, toY: ty, duration: duration)

    case "scroll":
        guard args.count >= 7,
              let x = Double(args[3]), let y = Double(args[4]),
              let dx = Int(args[5]), let dy = Int(args[6]) else {
            jsonError("Usage: mouse scroll <x> <y> <deltaX> <deltaY>"); exit(1)
        }
        mouseScroll(x: x, y: y, deltaX: dx, deltaY: dy)

    case "position":
        mousePosition()

    default:
        jsonError("Unknown mouse command: \(subcommand)")
    }

case "keyboard":
    switch subcommand {
    case "type":
        guard args.count >= 4 else {
            jsonError("Usage: keyboard type <text>"); exit(1)
        }
        let text = args[3...].joined(separator: " ")
        let interval = 50
        keyboardType(text: text, intervalMs: interval)

    case "press":
        guard args.count >= 4 else {
            jsonError("Usage: keyboard press <key> [modifiers...]"); exit(1)
        }
        let key = args[3]
        let modifiers = args.count >= 5 ? Array(args[4...]) : []
        keyboardPress(key: key, modifiers: modifiers)

    case "hotkey":
        guard args.count >= 4 else {
            jsonError("Usage: keyboard hotkey <key1+key2+...>"); exit(1)
        }
        let keys = args[3].split(separator: "+").map(String.init)
        keyboardHotkey(keys: keys)

    default:
        jsonError("Unknown keyboard command: \(subcommand)")
    }

case "screen":
    if subcommand == "info" {
        screenInfo()
    } else {
        jsonError("Unknown screen command: \(subcommand)")
    }

case "window":
    switch subcommand {
    case "list":
        windowList()
    case "focus":
        guard args.count >= 4 else { jsonError("Usage: window focus <appName>"); exit(1) }
        windowFocus(appName: args[3...].joined(separator: " "))
    case "resize":
        guard args.count >= 8,
              let x = Double(args[4]), let y = Double(args[5]),
              let w = Double(args[6]), let h = Double(args[7]) else {
            jsonError("Usage: window resize <app> <x> <y> <width> <height>"); exit(1)
        }
        windowResize(appName: args[3], x: x, y: y, width: w, height: h)
    case "minimize":
        guard args.count >= 4 else { jsonError("Usage: window minimize <appName>"); exit(1) }
        windowMinimize(appName: args[3...].joined(separator: " "))
    case "close":
        guard args.count >= 4 else { jsonError("Usage: window close <appName>"); exit(1) }
        windowClose(appName: args[3...].joined(separator: " "))
    default:
        jsonError("Unknown window command: \(subcommand)")
    }

case "accessibility":
    switch subcommand {
    case "check":
        accessibilityCheck()
    case "tree":
        let pid = args.count >= 4 ? Int32(args[3]) : nil
        let maxDepth = args.count >= 5 ? Int(args[4]) ?? 3 : 3
        accessibilityTree(pid: pid, maxDepth: maxDepth)
    case "element-at":
        guard args.count >= 5, let x = Double(args[3]), let y = Double(args[4]) else {
            jsonError("Usage: accessibility element-at <x> <y>"); exit(1)
        }
        accessibilityElementAtPoint(x: x, y: y)
    case "focused-position":
        accessibilityFocusedPosition()
    case "click":
        guard args.count >= 4 else {
            jsonError("Usage: accessibility click <role> [title] [pid]"); exit(1)
        }
        let role = args[3]
        let title = args.count >= 5 ? args[4] : nil
        let pid = args.count >= 6 ? Int32(args[5]) : nil
        accessibilityClickElement(role: role, title: title, appPid: pid)
    default:
        jsonError("Unknown accessibility command: \(subcommand)")
    }

case "apps":
    if subcommand == "list" {
        listApps()
    } else {
        jsonError("Unknown apps command: \(subcommand)")
    }

case "clipboard":
    switch subcommand {
    case "read":
        clipboardRead()
    case "write":
        guard args.count >= 4 else { jsonError("Usage: clipboard write <text>"); exit(1) }
        clipboardWrite(text: args[3...].joined(separator: " "))
    default:
        jsonError("Unknown clipboard command: \(subcommand)")
    }

default:
    printUsage()
    exit(1)
}
