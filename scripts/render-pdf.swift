// macOS QA: swift scripts/render-pdf.swift input.pdf output.png [dpi]
import AppKit
import PDFKit

let args = CommandLine.arguments
guard args.count >= 3, let document = PDFDocument(url: URL(fileURLWithPath: args[1])),
      let page = document.page(at: 0) else { fatalError("Expected a readable PDF and output PNG path") }
let dpi = args.count > 3 ? Double(args[3])! : 144
let bounds = page.bounds(for: .mediaBox)
let scale = dpi / 72
let width = Int((bounds.width * scale).rounded())
let height = Int((bounds.height * scale).rounded())
let image = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height,
  bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
  colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: image)
let context = NSGraphicsContext.current!.cgContext
context.setFillColor(NSColor.white.cgColor)
context.fill(CGRect(x: 0, y: 0, width: width, height: height))
context.scaleBy(x: scale, y: scale)
page.draw(with: .mediaBox, to: context)
NSGraphicsContext.restoreGraphicsState()
try image.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: args[2]))
print("\(width) × \(height) px at \(dpi) dpi; \(document.pageCount) PDF page(s)")
