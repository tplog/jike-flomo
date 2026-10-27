// Generate the two toolbar icon states without external dependencies.
import AppKit

let folder = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
for (name, color) in [("on", NSColor(srgbRed: 1, green: 0.89, blue: 0.07, alpha: 1)),
                      ("off", NSColor(srgbRed: 0.5, green: 0.5, blue: 0.5, alpha: 1))] {
    for size in [16, 32, 48, 128] {
        let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
            colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
        let context = NSGraphicsContext.current!.cgContext
        context.scaleBy(x: CGFloat(size) / 32, y: CGFloat(size) / 32)
        context.translateBy(x: 0, y: 32)
        context.scaleBy(x: 1, y: -1)
        context.setFillColor(color.cgColor)
        context.addPath(CGPath(roundedRect: CGRect(x: 0, y: 0, width: 32, height: 32),
            cornerWidth: 7, cornerHeight: 7, transform: nil))
        context.fillPath()
        let glyph = CGMutablePath()
        glyph.move(to: CGPoint(x: 18.5, y: 7))
        glyph.addLine(to: CGPoint(x: 23, y: 7))
        glyph.addLine(to: CGPoint(x: 20.5, y: 20))
        glyph.addCurve(to: CGPoint(x: 13.5, y: 26), control1: CGPoint(x: 19.7, y: 24), control2: CGPoint(x: 17.5, y: 26))
        glyph.addCurve(to: CGPoint(x: 9.5, y: 25), control1: CGPoint(x: 12, y: 26), control2: CGPoint(x: 10.7, y: 25.7))
        glyph.addLine(to: CGPoint(x: 10.6, y: 21.3))
        glyph.addCurve(to: CGPoint(x: 13.2, y: 22), control1: CGPoint(x: 11.5, y: 21.8), control2: CGPoint(x: 12.3, y: 22))
        glyph.addCurve(to: CGPoint(x: 16.2, y: 19.3), control1: CGPoint(x: 14.8, y: 22), control2: CGPoint(x: 15.8, y: 21.1))
        glyph.closeSubpath()
        context.setFillColor(NSColor.white.cgColor)
        context.addPath(glyph)
        context.fillPath()
        NSGraphicsContext.restoreGraphicsState()
        try bitmap.representation(using: .png, properties: [:])!.write(to: folder.appendingPathComponent("\(name)-\(size).png"))
    }
}
