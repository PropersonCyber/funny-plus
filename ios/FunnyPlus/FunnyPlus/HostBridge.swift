import CoreLocation
import UIKit
import WebKit

/**
 * 前端 ↔ 原生的注入点：定位结果、登录回调。
 *
 * 原生 Lynx 走 updateGlobalPropsWithDictionary:，这是能进 Worker 的通道。
 * Web 渲染器里同名实现是空函数，所以 WebHost 还要靠 sendGlobalEvent 和一段注入脚本。
 */
final class FPBridge {
    static let shared = FPBridge()

    weak var web: WKWebView?
    weak var lynxView: LynxView?

    private var lastLoc: CLLocation?
    private var lastErr: String?
    private var hasResult = false

    private init() {}

    func pushLocation(_ loc: CLLocation?, error: String?) {
        lastLoc = loc
        lastErr = error
        hasResult = true
        replay()
    }

    func flush() { replay() }

    /// 三方登录回跳。只认 funnyplus://auth，分享和深链以后各自加分支。
    @discardableResult
    static func handle(_ url: URL) -> Bool {
        guard url.scheme == "funnyplus", url.host == "auth" else { return false }
        var provider = "wechat"
        var code = ""
        for item in URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? [] {
            if item.name == "provider", let value = item.value, !value.isEmpty { provider = value }
            else if item.name == "code", let value = item.value, !value.isEmpty { code = value }
        }
        guard !code.isEmpty else { return false }
        let js = """
        (function(){var v=document.querySelector('lynx-view');if(!v)return;\
        var g=v.globalProps||{};g.__fpAuth={provider:'\(provider)',code:'\(code)',at:Date.now()};\
        v.globalProps=g;})()
        """
        shared.eval(js)
        return true
    }

    /// JS 侧请求拉起三方授权（`__fpStartAuth('wechat')`）。
    ///
    /// 微信要 WXApi.sendAuthReq、Apple 要 ASAuthorizationController，两者都只有原生能做。
    /// 这里不假装已经支持：SDK 未接入时返回 false，由 JS 显示「当前环境不支持」，
    /// 而不是让用户点一个永远没有反应的按钮。
    func startAuth(_ provider: String) -> Bool {
        switch provider {
        case "wechat":
            #if canImport(WechatOpenSDK)
            // 接上 SDK 后在这里构造 SendAuthReq 并注册 WXApi，见 docs/spec-ai-native-gap.md N5
            return false
            #else
            return false
            #endif
        case "apple":
            #if canImport(AuthenticationServices)
            // 接上后：ASAuthorizationAppleIDProvider → 拿 identityToken → 走 funnyplus://auth 回跳
            return false
            #else
            return false
            #endif
        default:
            return false
        }
    }

    private func replay() {
        guard hasResult else { return }
        if let lynxView {
            var props: [String: Any] = [:]
            if let lastLoc {
                props["__fpLocation"] = [
                    "lng": lastLoc.coordinate.longitude,
                    "lat": lastLoc.coordinate.latitude,
                    "accuracy": lastLoc.horizontalAccuracy,
                    "at": Date().timeIntervalSince1970 * 1000.0,
                ]
            } else {
                let msg = (lastErr?.isEmpty == false) ? lastErr! : "failed"
                props["__fpLocation"] = ["error": msg]
            }
            DispatchQueue.main.async {
                lynxView.updateGlobalProps(with: props)
            }
            return
        }

        let payload: String
        if lastLoc == nil {
            let msg = (lastErr?.isEmpty == false) ? lastErr! : "failed"
            payload = "{error:'\(jsonEscape(msg))'}"
        } else {
            let loc = lastLoc!
            let at = Date().timeIntervalSince1970 * 1000.0
            payload = String(
                format: "{lng:%.6f,lat:%.6f,accuracy:%.1f,at:%.0f}",
                loc.coordinate.longitude,
                loc.coordinate.latitude,
                loc.horizontalAccuracy,
                at
            )
        }
        // web-core 的 updateGlobalProps 在 Worker 侧是空函数，主通道是 sendGlobalEvent。
        // globalProps 只作为 init 期快照。lynx-view 实例在 bundle 解码完之前是空的，
        // 那几次写入会被静默丢掉，所以隔一段时间补几次。
        let js = """
        (function(){var v=document.querySelector('lynx-view');if(!v)return;\
        var g=v.globalProps||{};g.__fpLocation=\(payload);\
        v.globalProps=g;\
        try{v.sendGlobalEvent('__fpLocation',[\(payload)]);}catch(e){}\
        window.__fpLocation=\(payload);\
        })()
        """
        for delay in [0.0, 0.6, 1.4, 2.6, 4.0, 6.0] {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                self?.eval(js)
            }
        }
    }

    private func eval(_ js: String) {
        guard let web, !js.isEmpty else { return }
        DispatchQueue.main.async {
            web.evaluateJavaScript(js, completionHandler: nil)
        }
    }

    private func jsonEscape(_ s: String) -> String {
        s.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
            .replacingOccurrences(of: "\n", with: " ")
    }
}

/// 只要城市级精度，拿一次就停。持续定位要额外权限说明，也没有场景需要。
final class LocationHub: NSObject, CLLocationManagerDelegate {
    static let shared = LocationHub()

    private let manager = CLLocationManager()

    private override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyKilometer
    }

    func start() {
        switch manager.authorizationStatus {
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        case .denied, .restricted:
            FPBridge.shared.pushLocation(nil, error: "denied")
        default:
            manager.requestLocation()
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        switch manager.authorizationStatus {
        case .denied, .restricted:
            FPBridge.shared.pushLocation(nil, error: "denied")
        case .authorizedWhenInUse, .authorizedAlways:
            manager.requestLocation()
        default:
            break
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        FPBridge.shared.pushLocation(locations.last, error: nil)
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        FPBridge.shared.pushLocation(nil, error: "failed")
    }
}
