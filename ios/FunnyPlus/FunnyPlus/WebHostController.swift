import UIKit
import WebKit

private let kScheme = "app"

/// file:// 下 WKWebView 的 fetch 拿不到 wasm。用自定义 scheme 当静态文件服务器。
private final class LocalSchemeHandler: NSObject, WKURLSchemeHandler {
    var root = ""
    /// /api/* 由这里转发出去，避开 app:// 页面直接 fetch http 被 WebKit 拦掉
    var apiBase = ""

    func webView(_ webView: WKWebView, start urlSchemeTask: any WKURLSchemeTask) {
        var path = urlSchemeTask.request.url?.path ?? ""
        if path.hasPrefix("/api/") {
            proxy(urlSchemeTask, path: path)
            return
        }
        if path.hasPrefix("/") { path = String(path.dropFirst()) }
        if path.isEmpty { path = "index.html" }
        let file = (root as NSString).appendingPathComponent(path)
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: file)) else {
            urlSchemeTask.didFailWithError(
                NSError(domain: "local", code: 404, userInfo: [NSLocalizedDescriptionKey: "not found"])
            )
            return
        }
        let ext = (file as NSString).pathExtension.lowercased()
        let types = [
            "html": "text/html; charset=utf-8",
            "js": "text/javascript; charset=utf-8",
            "css": "text/css; charset=utf-8",
            "wasm": "application/wasm",
            "json": "application/json",
        ]
        let mime = types[ext] ?? "application/octet-stream"
        let resp = HTTPURLResponse(
            url: urlSchemeTask.request.url!,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: [
                "Content-Type": mime,
                "Content-Length": "\(data.count)",
                "Access-Control-Allow-Origin": "*",
            ]
        )!
        urlSchemeTask.didReceive(resp)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: any WKURLSchemeTask) {}

    private func proxy(_ task: any WKURLSchemeTask, path: String) {
        var url = apiBase + path
        if let query = task.request.url?.query, !query.isEmpty {
            url += "?\(query)"
        }
        guard let target = URL(string: url) else {
            task.didFailWithError(NSError(domain: "local", code: 400))
            return
        }
        var req = URLRequest(url: target)
        req.httpMethod = task.request.httpMethod ?? "GET"
        if let ct = task.request.value(forHTTPHeaderField: "content-type") {
            req.setValue(ct, forHTTPHeaderField: "content-type")
        }
        req.httpBody = body(of: task.request)
        URLSession.shared.dataTask(with: req) { data, response, error in
            DispatchQueue.main.async {
                if let error {
                    task.didFailWithError(error)
                    return
                }
                let http = response as? HTTPURLResponse
                let code = http?.statusCode ?? 500
                let type = http?.value(forHTTPHeaderField: "content-type") ?? "application/json"
                let out = HTTPURLResponse(
                    url: task.request.url!,
                    statusCode: code,
                    httpVersion: "HTTP/1.1",
                    headerFields: [
                        "Content-Type": type,
                        "Access-Control-Allow-Origin": "*",
                    ]
                )!
                task.didReceive(out)
                if let data, !data.isEmpty { task.didReceive(data) }
                task.didFinish()
            }
        }.resume()
    }

    private func body(of request: URLRequest) -> Data? {
        if let body = request.httpBody, !body.isEmpty { return body }
        guard let stream = request.httpBodyStream else { return nil }
        stream.open()
        defer { stream.close() }
        var data = Data()
        let buf = UnsafeMutablePointer<UInt8>.allocate(capacity: 1024)
        defer { buf.deallocate() }
        while stream.hasBytesAvailable {
            let n = stream.read(buf, maxLength: 1024)
            if n <= 0 { break }
            data.append(buf, count: n)
        }
        return data.isEmpty ? nil : data
    }
}

/// 旧的 WKWebView 壳，留着和原生 Lynx 对照。当前根控制器是 LynxHostController。
@objc(WebHostController)
final class WebHostController: UIViewController, WKNavigationDelegate {
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.96, green: 0.97, blue: 1.0, alpha: 1.0)

        let cfg = WKWebViewConfiguration()
        let handler = LocalSchemeHandler()
        handler.root = Bundle.main.path(forResource: "web", ofType: nil) ?? ""
        let configured = Bundle.main.object(forInfoDictionaryKey: "APIBase") as? String
        handler.apiBase = (configured?.isEmpty == false) ? configured! : "http://127.0.0.1:8787"
        cfg.setURLSchemeHandler(handler, forURLScheme: kScheme)

        let web = WKWebView(frame: view.bounds, configuration: cfg)
        web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        web.scrollView.isScrollEnabled = false
        web.scrollView.bounces = false
        web.isOpaque = false
        web.backgroundColor = .clear
        web.navigationDelegate = self
        if #available(iOS 16.4, *) { web.isInspectable = true }
        view.addSubview(web)
        FPBridge.shared.web = web
        web.load(URLRequest(url: URL(string: "app://local/index.html")!))

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
            LocationHub.shared.start()
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        FPBridge.shared.flush()
    }
}
