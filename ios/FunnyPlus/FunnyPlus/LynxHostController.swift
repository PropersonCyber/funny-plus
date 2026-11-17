import UIKit

/**
 * 原生 Lynx 宿主。
 *
 * Web 渲染器把业务 JS 关在 Worker 里，主线程写 globalProps / sendGlobalEvent 到不了。
 * 原生 Lynx 的 updateGlobalPropsWithDictionary: 是真的跨线程通道，定位靠它才通。
 */
final class LynxHostController: UIViewController {
    private var lynx: LynxView?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.96, green: 0.97, blue: 1.0, alpha: 1.0)

        // 图标是 SVG data URI。分类在进程启动时就挂上了，这里只确认一次。
        FPSVGRenderer.noteInstalled()
        FPInputUI.notePropConfigs()

        let env = LynxEnv.sharedInstance()
        env.logBoxEnabled = true
        env.devtoolEnabled = false

        // SDK 的 ui/ 里没有 input。不注册的话 <input> 会抛 LynxCreateUIException（9901）。
        // 必须放在 builder.config 上：LynxEnv.config 这个时机是懒的，读到 nil，注册会被丢掉。
        let config = fpMakeLynxConfig()
        let lynx = LynxView(builderBlock: { [weak self] builder in
            guard let self else { return }
            builder.frame = self.view.bounds
            builder.enableJSRuntime = true
            builder.config = config
        })
        lynx.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(lynx)
        self.lynx = lynx
        FPBridge.shared.lynxView = lynx

        guard let bundlePath = Bundle.main.path(forResource: "main.lynx", ofType: "bundle", inDirectory: "web") else {
            NSLog("[FunnyPlus] 缺 main.lynx.bundle，检查 Copy Bundle Resources")
            return
        }
        // 原生端没有 origin，相对路径的接口请求没有地方可去
        let configured = Bundle.main.object(forInfoDictionaryKey: "APIBase") as? String
        let apiBase = (configured?.isEmpty == false) ? configured! : "http://127.0.0.1:8787"
        let globalProps: [String: Any] = ["__fpApiBase": apiBase]
        lynx.updateGlobalProps(with: globalProps)

        // 用 binaryData 直接喂字节。loadTemplateFromURL: 对 file:// 没有回调也没有错误。
        guard let bundleData = try? Data(contentsOf: URL(fileURLWithPath: bundlePath)), !bundleData.isEmpty else {
            return
        }
        let meta = LynxLoadMeta()
        meta.url = bundlePath
        meta.binaryData = bundleData
        meta.loadMode = .normal
        meta.globalProps = LynxTemplateData(dictionary: globalProps)

        let client = LynxHostClient()
        client.onError = { error in
            let ns = error as NSError
            let info = String(describing: ns.userInfo).replacingOccurrences(of: "\n", with: " ")
            NSLog("%@", "[FunnyPlus] lynx error code=\(ns.code) info=\(info)" as NSString)
        }
        // setClient: 会把 client 同时赋给 imageFetcher。本类不加载图片，
        // 不置回 nil 的话位图（封面、地图）全空白，而且没有错误日志。
        // 置空之后 shouldUseImageService 成立，请求回到 LynxImageService + SDWebImage。
        lynx.client = client
        lynx.imageFetcher = nil
        lynx.loadTemplate(meta)
        FPBridge.shared.flush()

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
            LocationHub.shared.start()
        }
    }
}
