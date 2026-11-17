import UIKit

/**
 * SVG 解码，补 Lynx 4.2.0 没实现的 loadSVGImageWithURL:size:contextInfo:completed:。
 *
 * 协议上这个方法是 optional。LynxUIImage 发现 respondsToSelector 为 NO 就上报
 * code=30199 "SVG image loader is unavailable."，<image> 里的 SVG 图留白。
 * 图标字符串不走这里，走 LynxUISVG 的 content。
 *
 * 用分类挂到 LynxImageService 上，而不是 class_addMethod：
 * CGSize 按值传递，手写 block trampoline 的 type encoding 对不齐就会启动即崩。
 * 编译器给这个 @objc 方法生成的编码是准的。
 *
 * 覆盖本项目实际用到的子集：元素 svg / path / circle，
 * 指令 M L H V C S Q T A Z（含小写相对形式）。没有 rect / defs / 渐变。
 */
extension LynxImageService {
    @objc(loadSVGImageWithURL:size:contextInfo:completed:)
    func loadSVGImageWithURL(
        _ requestUrl: AnyObject,
        size: CGSize,
        contextInfo _: NSDictionary?,
        completed: @escaping (UIImage?, NSError?, NSURL?) -> Void
    ) {
        FPSVGRenderer.load(requestUrl, size: size, completed: completed)
    }
}

enum FPSVGRenderer {
    private static let cache: NSCache<NSString, UIImage> = {
        let cache = NSCache<NSString, UIImage>()
        cache.countLimit = 128
        return cache
    }()

    static func noteInstalled() {
        let sel = NSSelectorFromString("loadSVGImageWithURL:size:contextInfo:completed:")
        let ok = NSClassFromString("LynxImageService")?.instancesRespond(to: sel) == true
        NSLog("[FunnyPlus] SVG 解码器 %@", ok ? "已挂上" : "未挂上")
    }

    static func load(
        _ requestUrl: AnyObject,
        size: CGSize,
        completed: @escaping (UIImage?, NSError?, NSURL?) -> Void
    ) {
        let url = (requestUrl as? NSObject)?.value(forKey: "url") as? URL
        DispatchQueue.global(qos: .userInitiated).async {
            let src = url?.absoluteString ?? ""
            let key = NSString(format: "%@|%.0fx%.0f", src, size.width, size.height)
            var image = cache.object(forKey: key)
            var error: NSError?
            if image == nil {
                let svg = svgText(for: url)
                if svg?.isEmpty != false {
                    error = svgError("SVG 源无法读取（既不是 data URI，也不在 mainBundle 下）")
                } else if let rendered = render(svg!, target: size, scale: UIScreen.main.scale) {
                    image = rendered
                    cache.setObject(rendered, forKey: key)
                } else {
                    error = svgError("SVG 解析或光栅化失败")
                }
            }
            let result = image
            DispatchQueue.main.async {
                completed(result, error, url as NSURL?)
            }
        }
    }

    private static func svgError(_ message: String) -> NSError {
        NSError(domain: "LynxSVGImageErrorDomain", code: 30199, userInfo: [
            NSLocalizedDescriptionKey: message,
        ])
    }
}

// MARK: - 文档

private struct SVGShape {
    var pathData: String?
    var isCircle = false
    var cx: CGFloat = 0
    var cy: CGFloat = 0
    var r: CGFloat = 0
    var fill: UIColor?
    var stroke: UIColor?
    var strokeWidth: CGFloat = 1
    var opacity: CGFloat = 1
    var dash: [CGFloat] = []
}

private struct SVGDocument {
    var viewBox = CGRect(x: 0, y: 0, width: 24, height: 24)
    var shapes: [SVGShape] = []
}

private final class SVGXMLParser: NSObject, XMLParserDelegate {
    var elements: [(name: String, attrs: [String: String])] = []

    func parser(
        _ parser: XMLParser,
        didStartElement elementName: String,
        namespaceURI: String?,
        qualifiedName qName: String?,
        attributes attributeDict: [String: String] = [:]
    ) {
        elements.append((elementName, attributeDict))
    }
}

private func parseColor(_ raw: String?, fallback: UIColor?) -> UIColor? {
    guard let raw else { return fallback }
    let v = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    if v.isEmpty { return fallback }
    if v == "none" || v.caseInsensitiveCompare("transparent") == .orderedSame { return nil }
    if v.caseInsensitiveCompare("currentColor") == .orderedSame { return fallback }

    if v.hasPrefix("#") {
        let hex = String(v.dropFirst())
        var n: UInt64 = 0
        guard Scanner(string: hex).scanHexInt64(&n) else { return fallback }
        switch hex.count {
        case 3:
            return UIColor(
                red: CGFloat((n >> 8) & 0xF) / 15,
                green: CGFloat((n >> 4) & 0xF) / 15,
                blue: CGFloat(n & 0xF) / 15,
                alpha: 1
            )
        case 6:
            return UIColor(
                red: CGFloat((n >> 16) & 0xFF) / 255,
                green: CGFloat((n >> 8) & 0xFF) / 255,
                blue: CGFloat(n & 0xFF) / 255,
                alpha: 1
            )
        case 8:
            return UIColor(
                red: CGFloat((n >> 24) & 0xFF) / 255,
                green: CGFloat((n >> 16) & 0xFF) / 255,
                blue: CGFloat((n >> 8) & 0xFF) / 255,
                alpha: CGFloat(n & 0xFF) / 255
            )
        default:
            return fallback
        }
    }
    if v.hasPrefix("rgb") {
        let parts = v.split { "(), ".contains($0) }.map(String.init).filter { !$0.isEmpty }
        if parts.count >= 3 {
            let r = (Double(parts[0]) ?? 0) / 255
            let g = (Double(parts[1]) ?? 0) / 255
            let b = (Double(parts[2]) ?? 0) / 255
            let a = parts.count >= 4 ? (Double(parts[3]) ?? 1) : 1
            return UIColor(red: r, green: g, blue: b, alpha: a)
        }
    }
    return fallback
}

private func parseDocument(_ svg: String) -> SVGDocument? {
    guard let data = svg.data(using: .utf8) else { return nil }
    let delegate = SVGXMLParser()
    let parser = XMLParser(data: data)
    parser.delegate = delegate
    if !parser.parse(), delegate.elements.isEmpty { return nil }

    var doc = SVGDocument()
    var inheritFill: UIColor?
    var inheritStroke: UIColor?
    var inheritStrokeWidth: CGFloat = 1
    var docW: CGFloat = 0
    var docH: CGFloat = 0

    for el in delegate.elements {
        let a = el.attrs
        if el.name == "svg" {
            if let vb = a["viewBox"], !vb.isEmpty {
                let parts = vb.split { ", ".contains($0) }.map(String.init).filter { !$0.isEmpty }
                if parts.count == 4,
                   let x = Double(parts[0]), let y = Double(parts[1]),
                   let w = Double(parts[2]), let h = Double(parts[3]) {
                    doc.viewBox = CGRect(x: x, y: y, width: w, height: h)
                }
            }
            docW = CGFloat(Double(a["width"] ?? "") ?? 0)
            docH = CGFloat(Double(a["height"] ?? "") ?? 0)
            inheritFill = parseColor(a["fill"], fallback: nil)
            inheritStroke = parseColor(a["stroke"], fallback: nil)
            if let sw = a["stroke-width"], !sw.isEmpty { inheritStrokeWidth = CGFloat(Double(sw) ?? 1) }
            continue
        }
        guard el.name == "path" || el.name == "circle" else { continue }

        var shape = SVGShape()
        shape.fill = a["fill"] != nil ? parseColor(a["fill"], fallback: inheritFill) : inheritFill
        shape.stroke = a["stroke"] != nil ? parseColor(a["stroke"], fallback: inheritStroke) : inheritStroke
        if let sw = a["stroke-width"], !sw.isEmpty {
            shape.strokeWidth = CGFloat(Double(sw) ?? Double(inheritStrokeWidth))
        } else {
            shape.strokeWidth = inheritStrokeWidth
        }
        if let op = a["opacity"], !op.isEmpty { shape.opacity = CGFloat(Double(op) ?? 1) }
        if el.name == "circle" {
            shape.isCircle = true
            shape.cx = CGFloat(Double(a["cx"] ?? "") ?? 0)
            shape.cy = CGFloat(Double(a["cy"] ?? "") ?? 0)
            shape.r = CGFloat(Double(a["r"] ?? "") ?? 0)
        } else {
            shape.pathData = a["d"]
        }
        if let dashRaw = a["stroke-dasharray"], !dashRaw.isEmpty {
            var dashes = dashRaw.split { ", ".contains($0) }.compactMap { Double($0) }.map { CGFloat($0) }
            if dashes.count % 2 == 1 { dashes.append(contentsOf: dashes) }
            shape.dash = dashes
        }
        doc.shapes.append(shape)
    }
    if docW > 0, docH > 0, doc.viewBox == CGRect(x: 0, y: 0, width: 24, height: 24) {
        doc.viewBox = CGRect(x: 0, y: 0, width: docW, height: docH)
    }
    return doc
}

// MARK: - path

private func paramCount(_ c: Character) -> Int {
    switch c {
    case "M", "m", "L", "l", "T", "t": return 2
    case "H", "h", "V", "v": return 1
    case "C", "c": return 6
    case "S", "s", "Q", "q": return 4
    case "A", "a": return 7
    case "Z", "z": return 0
    default: return -1
    }
}

private struct PathScanner {
    let chars: [Character]
    var i = 0

    mutating func skipSeparators() {
        while i < chars.count {
            switch chars[i] {
            case ",", " ", "\t", "\n", "\r": i += 1
            default: return
            }
        }
    }

    mutating func scanNumber() -> Double? {
        skipSeparators()
        let start = i
        guard i < chars.count else { return nil }
        if chars[i] == "+" || chars[i] == "-" { i += 1 }
        var sawDigit = false
        var sawDot = false
        while i < chars.count {
            let c = chars[i]
            if c.isNumber {
                sawDigit = true
                i += 1
            } else if c == ".", !sawDot {
                sawDot = true
                i += 1
            } else {
                break
            }
        }
        if i < chars.count, chars[i] == "e" || chars[i] == "E" {
            let mark = i
            i += 1
            if i < chars.count, chars[i] == "+" || chars[i] == "-" { i += 1 }
            let exp = i
            while i < chars.count, chars[i].isNumber { i += 1 }
            if i == exp { i = mark }
        }
        guard sawDigit else {
            i = start
            return nil
        }
        return Double(String(chars[start..<i]))
    }

    mutating func peekCommand() -> Character? {
        skipSeparators()
        guard i < chars.count else { return nil }
        let c = chars[i]
        if (c >= "A" && c <= "Z") || (c >= "a" && c <= "z") {
            i += 1
            return c
        }
        return nil
    }
}

/// 椭圆弧转三次贝塞尔，按 SVG 规范附录 F.6.5。图标里的弧大多是圆角，但仍按通用椭圆算。
private func appendArc(
    _ path: CGMutablePath,
    from: CGPoint,
    rx rxIn: CGFloat,
    ry ryIn: CGFloat,
    rotationDeg: CGFloat,
    largeArc: Bool,
    sweep: Bool,
    to: CGPoint
) {
    if rxIn == 0 || ryIn == 0 {
        path.addLine(to: to)
        return
    }
    var rx = abs(rxIn)
    var ry = abs(ryIn)
    let phi = rotationDeg * .pi / 180
    let cosPhi = cos(phi)
    let sinPhi = sin(phi)
    let dx2 = (from.x - to.x) / 2
    let dy2 = (from.y - to.y) / 2
    let x1p = cosPhi * dx2 + sinPhi * dy2
    let y1p = -sinPhi * dx2 + cosPhi * dy2
    let lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
    if lambda > 1 {
        let k = sqrt(lambda)
        rx *= k
        ry *= k
    }
    let rx2 = rx * rx
    let ry2 = ry * ry
    let denom = rx2 * y1p * y1p + ry2 * x1p * x1p
    let numer = rx2 * ry2 - denom
    var coef: CGFloat = (numer <= 0 || denom <= 0) ? 0 : sqrt(numer / denom)
    if largeArc == sweep { coef = -coef }
    let cxp = coef * (rx * y1p / ry)
    let cyp = coef * (-ry * x1p / rx)
    let cx = cosPhi * cxp - sinPhi * cyp + (from.x + to.x) / 2
    let cy = sinPhi * cxp + cosPhi * cyp + (from.y + to.y) / 2
    let ux = (x1p - cxp) / rx
    let uy = (y1p - cyp) / ry
    let vx = (-x1p - cxp) / rx
    let vy = (-y1p - cyp) / ry
    let theta1 = atan2(uy, ux)
    var dTheta = atan2(ux * vy - uy * vx, ux * vx + uy * vy)
    if !sweep, dTheta > 0 { dTheta -= 2 * .pi }
    if sweep, dTheta < 0 { dTheta += 2 * .pi }
    var segments = Int(ceil(abs(dTheta) / (.pi / 2)))
    if segments < 1 { segments = 1 }
    let delta = dTheta / CGFloat(segments)
    let t = 4.0 / 3.0 * tan(delta / 4)
    var ang = theta1
    for _ in 0..<segments {
        let cosA = cos(ang)
        let sinA = sin(ang)
        let cosB = cos(ang + delta)
        let sinB = sin(ang + delta)
        let p1 = CGPoint(x: cosA - t * sinA, y: sinA + t * cosA)
        let p2 = CGPoint(x: cosB + t * sinB, y: sinB - t * cosB)
        let p3 = CGPoint(x: cosB, y: sinB)
        let c1 = CGPoint(
            x: cx + rx * (cosPhi * p1.x) - ry * (sinPhi * p1.y),
            y: cy + rx * (sinPhi * p1.x) + ry * (cosPhi * p1.y)
        )
        let c2 = CGPoint(
            x: cx + rx * (cosPhi * p2.x) - ry * (sinPhi * p2.y),
            y: cy + rx * (sinPhi * p2.x) + ry * (cosPhi * p2.y)
        )
        let end = CGPoint(
            x: cx + rx * (cosPhi * p3.x) - ry * (sinPhi * p3.y),
            y: cy + rx * (sinPhi * p3.x) + ry * (cosPhi * p3.y)
        )
        path.addCurve(to: end, control1: c1, control2: c2)
        ang += delta
    }
}

private func pathFromSVGData(_ d: String) -> CGPath? {
    if d.isEmpty { return nil }
    let path = CGMutablePath()
    var sc = PathScanner(chars: Array(d))
    var cmd: Character = "\0"
    var prev = [Double](repeating: 0, count: 7)
    var cur = CGPoint.zero
    var lastCtrl = CGPoint.zero
    var prevKind: Character = "\0"

    while true {
        if let next = sc.peekCommand() {
            cmd = next
        } else if cmd == "\0" {
            break
        } else if cmd == "M" {
            cmd = "L"
        } else if cmd == "m" {
            cmd = "l"
        } else if cmd == "Z" || cmd == "z" {
            break
        }

        let need = paramCount(cmd)
        // Z 的参数个数是 0。原来的实现在这里直接结束，不走进闭合分支。保持同一结果。
        if need <= 0 { break }
        var got = 0
        var truncated = false
        while got < need {
            guard let n = sc.scanNumber() else {
                truncated = true
                break
            }
            prev[got] = n
            got += 1
        }
        if truncated { break }

        let rel = cmd >= "a" && cmd <= "z"
        let ox: CGFloat = rel ? cur.x : 0
        let oy: CGFloat = rel ? cur.y : 0
        let upper = Character(String(cmd).uppercased())

        switch upper {
        case "M":
            let p = CGPoint(x: ox + prev[0], y: oy + prev[1])
            path.move(to: p)
            cur = p
            prevKind = "\0"
        case "L":
            let p = CGPoint(x: ox + prev[0], y: oy + prev[1])
            path.addLine(to: p)
            cur = p
            prevKind = "\0"
        case "H":
            let x = ox + prev[0]
            path.addLine(to: CGPoint(x: x, y: cur.y))
            cur.x = x
            prevKind = "\0"
        case "V":
            let y = oy + prev[0]
            path.addLine(to: CGPoint(x: cur.x, y: y))
            cur.y = y
            prevKind = "\0"
        case "C", "S":
            let c1: CGPoint
            let c2: CGPoint
            let end: CGPoint
            if upper == "C" {
                c1 = CGPoint(x: ox + prev[0], y: oy + prev[1])
                c2 = CGPoint(x: ox + prev[2], y: oy + prev[3])
                end = CGPoint(x: ox + prev[4], y: oy + prev[5])
            } else {
                c1 = (prevKind == "C" || prevKind == "S")
                    ? CGPoint(x: 2 * cur.x - lastCtrl.x, y: 2 * cur.y - lastCtrl.y)
                    : cur
                c2 = CGPoint(x: ox + prev[0], y: oy + prev[1])
                end = CGPoint(x: ox + prev[2], y: oy + prev[3])
            }
            path.addCurve(to: end, control1: c1, control2: c2)
            lastCtrl = c2
            cur = end
            prevKind = "C"
        case "Q", "T":
            let c: CGPoint
            let end: CGPoint
            if upper == "Q" {
                c = CGPoint(x: ox + prev[0], y: oy + prev[1])
                end = CGPoint(x: ox + prev[2], y: oy + prev[3])
            } else {
                c = (prevKind == "Q" || prevKind == "T")
                    ? CGPoint(x: 2 * cur.x - lastCtrl.x, y: 2 * cur.y - lastCtrl.y)
                    : cur
                end = CGPoint(x: ox + prev[0], y: oy + prev[1])
            }
            path.addQuadCurve(to: end, control: c)
            lastCtrl = c
            cur = end
            prevKind = "Q"
        case "A":
            let end = CGPoint(x: ox + prev[5], y: oy + prev[6])
            appendArc(
                path,
                from: cur,
                rx: prev[0],
                ry: prev[1],
                rotationDeg: prev[2],
                largeArc: prev[3] != 0,
                sweep: prev[4] != 0,
                to: end
            )
            cur = end
            prevKind = "\0"
        default:
            break
        }
    }
    return path
}

// MARK: - 渲染与取文本

private func render(_ svg: String, target: CGSize, scale: CGFloat) -> UIImage? {
    guard let doc = parseDocument(svg), !doc.shapes.isEmpty else { return nil }
    let vb = doc.viewBox
    if vb.width <= 0 || vb.height <= 0 { return nil }
    var pt = target
    if pt.width <= 0 || pt.height <= 0 { pt = vb.size }
    let pxScale = scale > 0 ? scale : UIScreen.main.scale
    let px = CGSize(
        width: max(1, (pt.width * pxScale).rounded()),
        height: max(1, (pt.height * pxScale).rounded())
    )
    UIGraphicsBeginImageContextWithOptions(px, false, 1)
    defer { UIGraphicsEndImageContext() }
    guard let ctx = UIGraphicsGetCurrentContext() else { return nil }
    ctx.scaleBy(x: px.width / vb.width, y: px.height / vb.height)
    ctx.translateBy(x: -vb.origin.x, y: -vb.origin.y)
    ctx.setLineCap(.round)
    ctx.setLineJoin(.round)

    for shape in doc.shapes {
        let path: CGPath?
        if shape.isCircle {
            let p = CGMutablePath()
            if shape.r > 0 {
                p.addEllipse(in: CGRect(
                    x: shape.cx - shape.r,
                    y: shape.cy - shape.r,
                    width: shape.r * 2,
                    height: shape.r * 2
                ))
            }
            path = p
        } else {
            path = pathFromSVGData(shape.pathData ?? "")
        }
        guard let path else { continue }
        let hasFill = shape.fill != nil
        let hasStroke = shape.stroke != nil && shape.strokeWidth > 0
        ctx.setAlpha(min(1, max(0, shape.opacity)))
        if hasFill, let fill = shape.fill {
            ctx.addPath(path)
            ctx.setFillColor(fill.cgColor)
            ctx.fillPath()
        }
        if hasStroke, let stroke = shape.stroke {
            ctx.addPath(path)
            ctx.setStrokeColor(stroke.cgColor)
            ctx.setLineWidth(shape.strokeWidth)
            if !shape.dash.isEmpty {
                ctx.setLineDash(phase: 0, lengths: shape.dash)
            }
            ctx.strokePath()
        }
    }
    return UIGraphicsGetImageFromCurrentImageContext()
}

private func textFromDataURI(_ url: URL) -> String? {
    let s = url.absoluteString
    guard let comma = s.range(of: ",") else { return nil }
    let head = String(s[..<comma.lowerBound])
    let body = String(s[comma.upperBound...])
    if head.lowercased().contains(";base64") {
        guard let data = Data(base64Encoded: body, options: .ignoreUnknownCharacters) else { return nil }
        return String(data: data, encoding: .utf8)
    }
    return body.removingPercentEncoding ?? body
}

private func svgText(for url: URL?) -> String? {
    guard let url else { return nil }
    if url.scheme == "data" { return textFromDataURI(url) }
    if url.isFileURL { return try? String(contentsOf: url, encoding: .utf8) }
    let rel = url.absoluteString
    if rel.hasPrefix("Resource/") {
        let name = (rel as NSString).deletingPathExtension
        let ext = (rel as NSString).pathExtension
        if let path = Bundle.main.path(forResource: name, ofType: ext) {
            return try? String(contentsOfFile: path, encoding: .utf8)
        }
    }
    return nil
}
