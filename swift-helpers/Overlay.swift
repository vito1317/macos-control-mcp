// Visual Overlay for AI Actions — click ripples, mouse trails, typing indicators
// Creates a transparent, click-through window that covers the entire screen
// Receives JSON commands via stdin and renders CoreAnimation effects
// Author: vito1317 <service@vito1317.com>

import Cocoa
import Foundation

// MARK: - Animation Types

struct ClickAnimation: Codable {
    let x: Double
    let y: Double
    let button: String?    // "left", "right", "double"
    let color: String?     // hex color
    let duration: Double?  // seconds
}

struct TrailAnimation: Codable {
    let points: [[Double]]   // [[x1,y1], [x2,y2], ...]
    let color: String?
    let duration: Double?
    let width: Double?
}

struct TypeAnimation: Codable {
    let x: Double
    let y: Double
    let text: String
    let color: String?
    let duration: Double?
}

struct HighlightAnimation: Codable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
    let color: String?
    let label: String?
    let duration: Double?
}

struct ScrollAnimation: Codable {
    let x: Double
    let y: Double
    let direction: String  // "up" or "down"
    let color: String?
    let duration: Double?
}

struct Command: Codable {
    let action: String
    let click: ClickAnimation?
    let trail: TrailAnimation?
    let type_anim: TypeAnimation?
    let highlight: HighlightAnimation?
    let scroll: ScrollAnimation?
}

// MARK: - Color Helper

func parseHexColor(_ hex: String?, defaultColor: NSColor = NSColor.systemBlue) -> NSColor {
    guard let hex = hex?.trimmingCharacters(in: CharacterSet(charactersIn: "#")) else {
        return defaultColor
    }
    var rgb: UInt64 = 0
    Scanner(string: hex).scanHexInt64(&rgb)
    return NSColor(
        red: CGFloat((rgb >> 16) & 0xFF) / 255.0,
        green: CGFloat((rgb >> 8) & 0xFF) / 255.0,
        blue: CGFloat(rgb & 0xFF) / 255.0,
        alpha: 1.0
    )
}

// MARK: - Overlay Window

class OverlayWindow: NSWindow {
    init() {
        // Use CGDisplayBounds for the primary display to get exact CG coordinate space.
        // This ensures the overlay window covers the full screen in CG coordinates,
        // which is the same coordinate system used by CGEvent, Accessibility API,
        // and the coordinates we receive from the bridge.
        let cgBounds = CGDisplayBounds(CGMainDisplayID())
        // CGDisplayBounds for primary display: {0, 0, width, height} (CG top-left origin)
        // NSWindow contentRect uses AppKit coords (bottom-left origin)
        // For primary display, both have origin (0,0) and same size — they're equivalent.
        let screenFrame = NSRect(
            x: cgBounds.origin.x,
            y: 0,
            width: cgBounds.width,
            height: cgBounds.height
        )

        super.init(
            contentRect: screenFrame,
            styleMask: .borderless,
            backing: .buffered,
            defer: false
        )

        self.level = .screenSaver  // Above everything including menu bar / notch
        self.isOpaque = false
        self.backgroundColor = .clear
        self.ignoresMouseEvents = true
        self.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        self.hasShadow = false

        let viewFrame = NSRect(x: 0, y: 0, width: cgBounds.width, height: cgBounds.height)
        let view = OverlayView(frame: viewFrame)
        self.contentView = view
    }
}

// MARK: - Overlay View

class OverlayView: NSView {
    var animationItems: [AnimationItem] = []

    override var isFlipped: Bool { return true }

    override func draw(_ dirtyRect: NSRect) {
        NSColor.clear.setFill()
        dirtyRect.fill()

        let now = CACurrentMediaTime()
        for anim in animationItems {
            if now < anim.endTime {
                let progress = (now - anim.startTime) / (anim.endTime - anim.startTime)
                anim.draw(in: self, progress: progress)
            }
        }

        // Cleanup finished animations
        animationItems.removeAll { now >= $0.endTime }
    }

    func addAnimItem(_ item: AnimationItem) {
        animationItems.append(item)
        startRefreshing()
    }

    private var displayLink: CVDisplayLink?

    func startRefreshing() {
        guard displayLink == nil else { return }

        // Use a timer-based approach for smooth animation
        let timer = Timer(timeInterval: 1.0/60.0, repeats: true) { [weak self] _ in
            guard let self = self else { return }
            self.needsDisplay = true
            if self.animationItems.isEmpty {
                self.stopRefreshing()
            }
        }
        RunLoop.main.add(timer, forMode: .common)
        objc_setAssociatedObject(self, "refreshTimer", timer, .OBJC_ASSOCIATION_RETAIN)
    }

    func stopRefreshing() {
        if let timer = objc_getAssociatedObject(self, "refreshTimer") as? Timer {
            timer.invalidate()
            objc_setAssociatedObject(self, "refreshTimer", nil, .OBJC_ASSOCIATION_RETAIN)
        }
        displayLink = nil
    }
}

// MARK: - Animation Items

protocol AnimationItem: AnyObject {
    var startTime: Double { get }
    var endTime: Double { get }
    func draw(in view: NSView, progress: Double)
}

// --- Click Ripple Animation ---
class ClickRippleAnimation: AnimationItem {
    let startTime: Double
    let endTime: Double
    let center: NSPoint
    let color: NSColor
    let isDouble: Bool
    let isRight: Bool

    init(x: Double, y: Double, color: NSColor, duration: Double, button: String?) {
        self.startTime = CACurrentMediaTime()
        self.endTime = startTime + duration
        self.center = NSPoint(x: x, y: y)
        self.color = color
        self.isDouble = button == "double"
        self.isRight = button == "right"
    }

    func draw(in view: NSView, progress: Double) {
        let ctx = NSGraphicsContext.current!.cgContext

        // Ring 1: expanding ripple
        let maxRadius: CGFloat = 40
        let radius1 = CGFloat(progress) * maxRadius
        let alpha1 = CGFloat(1.0 - progress) * 0.8

        ctx.setStrokeColor(color.withAlphaComponent(alpha1).cgColor)
        ctx.setLineWidth(3.0)
        ctx.strokeEllipse(in:CGRect(
            x: center.x - radius1, y: center.y - radius1,
            width: radius1 * 2, height: radius1 * 2
        ))

        // Ring 2: second ripple (delayed)
        if progress > 0.15 {
            let p2 = (progress - 0.15) / 0.85
            let radius2 = CGFloat(p2) * maxRadius * 0.7
            let alpha2 = CGFloat(1.0 - p2) * 0.6

            ctx.setStrokeColor(color.withAlphaComponent(alpha2).cgColor)
            ctx.setLineWidth(2.0)
            ctx.strokeEllipse(in:CGRect(
                x: center.x - radius2, y: center.y - radius2,
                width: radius2 * 2, height: radius2 * 2
            ))
        }

        // Center dot (fading)
        let dotRadius: CGFloat = 6
        let dotAlpha = CGFloat(1.0 - progress)
        ctx.setFillColor(color.withAlphaComponent(dotAlpha).cgColor)
        ctx.fillEllipse(in:CGRect(
            x: center.x - dotRadius, y: center.y - dotRadius,
            width: dotRadius * 2, height: dotRadius * 2
        ))

        // Double-click indicator: second pulse
        if isDouble && progress > 0.3 {
            let p3 = (progress - 0.3) / 0.7
            let radius3 = CGFloat(p3) * maxRadius * 1.2
            let alpha3 = CGFloat(1.0 - p3) * 0.5

            ctx.setStrokeColor(color.withAlphaComponent(alpha3).cgColor)
            ctx.setLineWidth(2.5)
            ctx.strokeEllipse(in:CGRect(
                x: center.x - radius3, y: center.y - radius3,
                width: radius3 * 2, height: radius3 * 2
            ))
        }

        // Right-click indicator: small arc
        if isRight {
            let arcAlpha = CGFloat(1.0 - progress) * 0.7
            ctx.setStrokeColor(NSColor.white.withAlphaComponent(arcAlpha).cgColor)
            ctx.setLineWidth(2.0)
            ctx.addArc(center: center, radius: 12, startAngle: -.pi/4, endAngle: .pi/4, clockwise: false)
            ctx.strokePath()
        }
    }
}

// --- Mouse Trail Animation ---
class MouseTrailAnimation: AnimationItem {
    let startTime: Double
    let endTime: Double
    let points: [NSPoint]
    let color: NSColor
    let lineWidth: CGFloat

    init(points: [[Double]], color: NSColor, duration: Double, width: Double) {
        self.startTime = CACurrentMediaTime()
        self.endTime = startTime + duration
        self.points = points.map { NSPoint(x: $0[0], y: $0[1]) }
        self.color = color
        self.lineWidth = CGFloat(width)
    }

    func draw(in view: NSView, progress: Double) {
        guard points.count >= 2 else { return }
        let ctx = NSGraphicsContext.current!.cgContext

        // Draw the trail with fading effect
        let visibleCount = Int(Double(points.count) * min(progress * 2, 1.0))
        guard visibleCount >= 2 else { return }

        for i in 1..<visibleCount {
            let segmentProgress = Double(i) / Double(visibleCount)
            let fadeProgress = progress > 0.5 ? (progress - 0.5) * 2 : 0
            let alpha = CGFloat((1.0 - fadeProgress) * segmentProgress) * 0.8

            ctx.setStrokeColor(color.withAlphaComponent(alpha).cgColor)
            ctx.setLineWidth(lineWidth * CGFloat(segmentProgress))
            ctx.setLineCap(.round)

            ctx.move(to: points[i - 1])
            ctx.addLine(to: points[i])
            ctx.strokePath()
        }

        // Draw moving dot at the head
        if visibleCount > 0 && progress < 0.8 {
            let headIdx = min(visibleCount - 1, points.count - 1)
            let headPt = points[headIdx]
            let dotAlpha = CGFloat(1.0 - progress)

            // Glow effect
            ctx.setFillColor(color.withAlphaComponent(dotAlpha * 0.3).cgColor)
            ctx.fillEllipse(in:CGRect(x: headPt.x - 10, y: headPt.y - 10, width: 20, height: 20))

            // Core dot
            ctx.setFillColor(color.withAlphaComponent(dotAlpha).cgColor)
            ctx.fillEllipse(in:CGRect(x: headPt.x - 5, y: headPt.y - 5, width: 10, height: 10))
        }
    }
}

// --- Type Animation ---
class TypeTextAnimation: AnimationItem {
    let startTime: Double
    let endTime: Double
    let position: NSPoint
    let text: String
    let color: NSColor

    init(x: Double, y: Double, text: String, color: NSColor, duration: Double) {
        self.startTime = CACurrentMediaTime()
        self.endTime = startTime + duration
        self.position = NSPoint(x: x, y: y)
        self.text = text
        self.color = color
    }

    func draw(in view: NSView, progress: Double) {
        let ctx = NSGraphicsContext.current!.cgContext

        // Calculate visible characters (typing effect)
        let visibleLen = Int(Double(text.count) * min(progress * 1.5, 1.0))
        let visibleText = String(text.prefix(visibleLen))

        let fadeAlpha = progress > 0.7 ? CGFloat((1.0 - progress) / 0.3) : CGFloat(1.0)

        // Anchor point: position is the mouse cursor / caret location.
        // Draw everything to the RIGHT and BELOW the anchor so the animation
        // visually appears at (or just below) the text insertion point.
        let anchorX = position.x + 4   // slight right offset from cursor
        let anchorY = position.y + 2   // slight down offset from cursor

        // Background pill
        let font = NSFont.systemFont(ofSize: 14, weight: .medium)
        let attrs: [NSAttributedString.Key: Any] = [
            .font: font,
            .foregroundColor: NSColor.white.withAlphaComponent(fadeAlpha)
        ]
        let textSize = (visibleText as NSString).size(withAttributes: attrs)
        let padding: CGFloat = 10

        // Keyboard icon — right at the anchor
        let kbAlpha = fadeAlpha * 0.6
        ctx.setFillColor(color.withAlphaComponent(kbAlpha).cgColor)
        ctx.setStrokeColor(color.withAlphaComponent(kbAlpha).cgColor)
        ctx.setLineWidth(1.5)
        let kbRect = CGRect(x: anchorX, y: anchorY, width: 30, height: 18)
        ctx.stroke(kbRect)

        // Small keys on keyboard icon
        for row in 0..<2 {
            for col in 0..<4 {
                let kx = anchorX + 4 + CGFloat(col) * 7
                let ky = anchorY + 3 + CGFloat(row) * 7
                ctx.fill(CGRect(x: kx, y: ky, width: 4, height: 4))
            }
        }

        // Text bubble — below the keyboard icon
        let bubbleY = anchorY + 22
        let bgRect = CGRect(
            x: anchorX,
            y: bubbleY,
            width: textSize.width + padding * 2,
            height: textSize.height + padding
        )

        // Draw rounded background
        let bgAlpha = fadeAlpha * 0.85
        ctx.setFillColor(color.withAlphaComponent(bgAlpha).cgColor)
        let path = CGPath(roundedRect: bgRect, cornerWidth: 8, cornerHeight: 8, transform: nil)
        ctx.addPath(path)
        ctx.fillPath()

        // Draw text
        if !visibleText.isEmpty {
            (visibleText as NSString).draw(
                at: NSPoint(x: anchorX + padding, y: bubbleY + padding / 2),
                withAttributes: attrs
            )
        }

        // Cursor blink
        if progress < 0.8 {
            let cursorOn = Int(progress * 10) % 2 == 0
            if cursorOn {
                let cursorX = anchorX + padding + textSize.width + 2
                ctx.setFillColor(NSColor.white.withAlphaComponent(fadeAlpha).cgColor)
                ctx.fill(CGRect(x: cursorX, y: bubbleY + padding / 2, width: 2, height: textSize.height))
            }
        }
    }
}

// --- Highlight Box Animation ---
class HighlightBoxAnimation: AnimationItem {
    let startTime: Double
    let endTime: Double
    let rect: CGRect
    let color: NSColor
    let label: String?

    init(x: Double, y: Double, width: Double, height: Double, color: NSColor, label: String?, duration: Double) {
        self.startTime = CACurrentMediaTime()
        self.endTime = startTime + duration
        self.rect = CGRect(x: x, y: y, width: width, height: height)
        self.color = color
        self.label = label
    }

    func draw(in view: NSView, progress: Double) {
        let ctx = NSGraphicsContext.current!.cgContext

        let fadeIn = min(progress * 4, 1.0)
        let fadeOut = progress > 0.7 ? CGFloat((1.0 - progress) / 0.3) : CGFloat(1.0)
        let alpha = CGFloat(fadeIn) * fadeOut

        // Pulsing border
        let pulse = sin(progress * .pi * 4) * 0.3 + 0.7
        let borderAlpha = alpha * CGFloat(pulse)

        // Fill with translucent color
        ctx.setFillColor(color.withAlphaComponent(alpha * 0.15).cgColor)
        let path = CGPath(roundedRect: rect, cornerWidth: 4, cornerHeight: 4, transform: nil)
        ctx.addPath(path)
        ctx.fillPath()

        // Border
        ctx.setStrokeColor(color.withAlphaComponent(borderAlpha).cgColor)
        ctx.setLineWidth(2.5)
        ctx.addPath(path)
        ctx.strokePath()

        // Corner markers
        let cornerLen: CGFloat = 10
        ctx.setStrokeColor(color.withAlphaComponent(alpha).cgColor)
        ctx.setLineWidth(3)

        // Top-left
        ctx.move(to: CGPoint(x: rect.minX, y: rect.maxY - cornerLen))
        ctx.addLine(to: CGPoint(x: rect.minX, y: rect.maxY))
        ctx.addLine(to: CGPoint(x: rect.minX + cornerLen, y: rect.maxY))
        ctx.strokePath()

        // Top-right
        ctx.move(to: CGPoint(x: rect.maxX - cornerLen, y: rect.maxY))
        ctx.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
        ctx.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - cornerLen))
        ctx.strokePath()

        // Bottom-left
        ctx.move(to: CGPoint(x: rect.minX, y: rect.minY + cornerLen))
        ctx.addLine(to: CGPoint(x: rect.minX, y: rect.minY))
        ctx.addLine(to: CGPoint(x: rect.minX + cornerLen, y: rect.minY))
        ctx.strokePath()

        // Bottom-right
        ctx.move(to: CGPoint(x: rect.maxX - cornerLen, y: rect.minY))
        ctx.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
        ctx.addLine(to: CGPoint(x: rect.maxX, y: rect.minY - cornerLen))
        ctx.strokePath()

        // Label
        if let label = label, !label.isEmpty {
            let font = NSFont.systemFont(ofSize: 11, weight: .semibold)
            let attrs: [NSAttributedString.Key: Any] = [
                .font: font,
                .foregroundColor: NSColor.white.withAlphaComponent(alpha)
            ]
            let textSize = (label as NSString).size(withAttributes: attrs)
            let labelBg = CGRect(
                x: rect.midX - textSize.width/2 - 6,
                y: rect.maxY + 4,
                width: textSize.width + 12,
                height: textSize.height + 4
            )
            ctx.setFillColor(color.withAlphaComponent(alpha * 0.9).cgColor)
            let labelPath = CGPath(roundedRect: labelBg, cornerWidth: 4, cornerHeight: 4, transform: nil)
            ctx.addPath(labelPath)
            ctx.fillPath()

            (label as NSString).draw(
                at: NSPoint(x: labelBg.origin.x + 6, y: labelBg.origin.y + 2),
                withAttributes: attrs
            )
        }
    }
}

// --- Scroll Animation ---
class ScrollIndicatorAnimation: AnimationItem {
    let startTime: Double
    let endTime: Double
    let center: NSPoint
    let isUp: Bool
    let color: NSColor

    init(x: Double, y: Double, direction: String, color: NSColor, duration: Double) {
        self.startTime = CACurrentMediaTime()
        self.endTime = startTime + duration
        self.center = NSPoint(x: x, y: y)
        self.isUp = direction == "up"
        self.color = color
    }

    func draw(in view: NSView, progress: Double) {
        let ctx = NSGraphicsContext.current!.cgContext
        let alpha = CGFloat(1.0 - progress)

        // Draw scroll arrows
        let arrowCount = 3
        for i in 0..<arrowCount {
            let offset = CGFloat(i) * 15 * (isUp ? 1 : -1)
            let delay = Double(i) * 0.15
            let p = max(0, min(1, (progress - delay) / (1.0 - delay)))
            let arrowAlpha = alpha * CGFloat(1.0 - p)
            let move = CGFloat(p) * 20 * (isUp ? 1 : -1)

            let y = center.y + offset + move
            ctx.setStrokeColor(color.withAlphaComponent(arrowAlpha).cgColor)
            ctx.setLineWidth(2.5)
            ctx.setLineCap(.round)

            let dir: CGFloat = isUp ? 1 : -1
            ctx.move(to: CGPoint(x: center.x - 10, y: y - 6 * dir))
            ctx.addLine(to: CGPoint(x: center.x, y: y + 6 * dir))
            ctx.addLine(to: CGPoint(x: center.x + 10, y: y - 6 * dir))
            ctx.strokePath()
        }
    }
}

// MARK: - App Delegate

class AppDelegate: NSObject, NSApplicationDelegate {
    var overlayWindow: OverlayWindow!

    func applicationDidFinishLaunching(_ notification: Notification) {
        overlayWindow = OverlayWindow()
        overlayWindow.orderFrontRegardless()

        // Signal readiness to bridge
        fputs("READY\n", stdout)
        fflush(stdout)

        // Listen for stdin commands on background thread
        DispatchQueue.global(qos: .userInteractive).async { [weak self] in
            self?.readCommands()
        }
    }

    func readCommands() {
        while let line = readLine() {
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty { continue }
            if trimmed == "quit" || trimmed == "exit" {
                DispatchQueue.main.async {
                    NSApplication.shared.terminate(nil)
                }
                return
            }

            guard let data = trimmed.data(using: .utf8),
                  let cmd = try? JSONDecoder().decode(Command.self, from: data) else {
                let err: [String: Any] = ["success": false, "error": "Invalid JSON command"]
                if let errData = try? JSONSerialization.data(withJSONObject: err),
                   let errStr = String(data: errData, encoding: .utf8) {
                    fputs(errStr + "\n", stdout)
                    fflush(stdout)
                }
                continue
            }

            DispatchQueue.main.async { [weak self] in
                self?.handleCommand(cmd)
            }
        }
    }

    func handleCommand(_ cmd: Command) {
        guard let view = overlayWindow.contentView as? OverlayView else { return }

        // Ensure overlay still covers the full screen (handles resolution changes)
        let cgBounds = CGDisplayBounds(CGMainDisplayID())
        let expectedFrame = NSRect(x: cgBounds.origin.x, y: 0, width: cgBounds.width, height: cgBounds.height)
        if overlayWindow.frame != expectedFrame {
            overlayWindow.setFrame(expectedFrame, display: true)
        }

        switch cmd.action {
        case "click":
            if let c = cmd.click {
                let color = parseHexColor(c.color, defaultColor: .systemBlue)
                let duration = c.duration ?? 0.6
                let anim = ClickRippleAnimation(x: c.x, y: c.y, color: color, duration: duration, button: c.button)
                view.addAnimItem(anim)
            }

        case "trail":
            if let t = cmd.trail {
                let color = parseHexColor(t.color, defaultColor: .systemGreen)
                let duration = t.duration ?? 1.5
                let width = t.width ?? 3.0
                let anim = MouseTrailAnimation(points: t.points, color: color, duration: duration, width: width)
                view.addAnimItem(anim)
            }

        case "type":
            if let t = cmd.type_anim {
                let color = parseHexColor(t.color, defaultColor: .systemPurple)
                let duration = t.duration ?? 2.0
                let anim = TypeTextAnimation(x: t.x, y: t.y, text: t.text, color: color, duration: duration)
                view.addAnimItem(anim)
            }

        case "highlight":
            if let h = cmd.highlight {
                let color = parseHexColor(h.color, defaultColor: .systemOrange)
                let duration = h.duration ?? 2.0
                let anim = HighlightBoxAnimation(x: h.x, y: h.y, width: h.width, height: h.height, color: color, label: h.label, duration: duration)
                view.addAnimItem(anim)
            }

        case "scroll":
            if let s = cmd.scroll {
                let color = parseHexColor(s.color, defaultColor: .systemCyan)
                let duration = s.duration ?? 0.8
                let anim = ScrollIndicatorAnimation(x: s.x, y: s.y, direction: s.direction, color: color, duration: duration)
                view.addAnimItem(anim)
            }

        default:
            break
        }

        // Acknowledge
        let ack = ["success": true, "action": cmd.action] as [String: Any]
        if let data = try? JSONSerialization.data(withJSONObject: ack),
           let str = String(data: data, encoding: .utf8) {
            fputs(str + "\n", stdout)
            fflush(stdout)
        }
    }
}

// MARK: - Main Entry

let app = NSApplication.shared
app.setActivationPolicy(.accessory) // No dock icon
let delegate = AppDelegate()
app.delegate = delegate
app.run()
